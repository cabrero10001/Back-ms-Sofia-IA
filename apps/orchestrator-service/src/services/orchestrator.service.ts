import { createLogger } from '@sofia/observability';
import { classifyExtract, type AIResult } from '../clients/aiServiceClient';
import { conversationClient } from '../clients/conversation.client';
import {
  ConversationChannel,
  ConversationMessageType,
  MessageIn,
  MessageOut,
  OrchestratorResponse,
} from '../dtos';

const log = createLogger('orchestrator-service-logic');

type Intent = 'general' | 'consulta_laboral' | 'soporte';
type Step = 'ask_intent' | 'ask_city' | 'ask_age' | 'collecting_issue' | 'ready_for_handoff' | 'ask_issue';

interface OrchestratorContext {
  intent?: Intent;
  step?: Step;
  profile?: Record<string, unknown>;
}

interface Decision {
  patch: Record<string, unknown>;
  responseText: string;
  nextIntent: Intent;
  nextStep: Step;
}

function mapChannel(channel: MessageIn['channel']): ConversationChannel {
  return channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT';
}

function mapMessageType(type: MessageIn['message']['type']): ConversationMessageType {
  const map: Record<MessageIn['message']['type'], ConversationMessageType> = {
    text: 'TEXT',
    image: 'IMAGE',
    audio: 'AUDIO',
    document: 'DOCUMENT',
    interactive: 'INTERACTIVE',
  };
  return map[type];
}

function normalizeText(text?: string): string {
  return (text ?? '').trim().toLowerCase();
}

function parseAge(text: string): number | undefined {
  const match = text.match(/\d{1,3}/);
  if (!match) return undefined;

  const age = Number.parseInt(match[0], 10);
  if (!Number.isFinite(age) || age <= 0 || age > 120) return undefined;
  return age;
}

function parseContext(raw: Record<string, unknown>): OrchestratorContext {
  return {
    intent: typeof raw.intent === 'string' ? (raw.intent as Intent) : undefined,
    step: typeof raw.step === 'string' ? (raw.step as Step) : undefined,
    profile: typeof raw.profile === 'object' && raw.profile !== null
      ? (raw.profile as Record<string, unknown>)
      : undefined,
  };
}

function localFallbackAI(text: string): AIResult {
  const shouldReset = text.includes('menu') || text.includes('cambiar');

  let intent: Intent = 'general';
  if (text.includes('laboral') || text.includes('trabajo') || text.includes('empleo')) {
    intent = 'consulta_laboral';
  } else if (text.includes('soporte') || text.includes('error') || text.includes('problema')) {
    intent = 'soporte';
  }

  return {
    intent: shouldReset ? 'general' : intent,
    confidence: 0,
    entities: {},
    shouldReset,
  };
}

function pickEntityCity(ai: AIResult): string | undefined {
  const city = ai.entities?.city;
  return typeof city === 'string' && city.trim() ? city.trim() : undefined;
}

function pickEntityAge(ai: AIResult): number | undefined {
  const age = ai.entities?.age;
  return typeof age === 'number' && age > 0 && age <= 120 ? age : undefined;
}

function decideNextAction(text: string, context: OrchestratorContext, ai: AIResult): Decision {
  if (ai.shouldReset === true) {
    return {
      patch: { intent: 'general', step: 'ask_intent', profile: {} },
      responseText: 'Listo 👋 ¿En qué te puedo ayudar? Responde: laboral o soporte.',
      nextIntent: 'general',
      nextStep: 'ask_intent',
    };
  }

  const cityFromAI = pickEntityCity(ai);
  const ageFromAI = pickEntityAge(ai);

  if (!context.step || context.step === 'ask_intent' || !context.intent) {
    if (ai.intent === 'consulta_laboral') {
      if (cityFromAI && ageFromAI) {
        return {
          patch: {
            intent: 'consulta_laboral',
            step: 'ready_for_handoff',
            profile: { city: cityFromAI, age: ageFromAI },
          },
          responseText: 'Listo ✅ Ya tengo tu información. Te paso con un asesor.',
          nextIntent: 'consulta_laboral',
          nextStep: 'ready_for_handoff',
        };
      }

      if (cityFromAI && !ageFromAI) {
        return {
          patch: {
            intent: 'consulta_laboral',
            step: 'ask_age',
            profile: { city: cityFromAI },
          },
          responseText: 'Gracias. ¿Cuál es tu edad?',
          nextIntent: 'consulta_laboral',
          nextStep: 'ask_age',
        };
      }

      return {
        patch: {
          intent: 'consulta_laboral',
          step: 'ask_city',
          ...(ageFromAI ? { profile: { age: ageFromAI } } : {}),
        },
        responseText: 'Perfecto. ¿En qué ciudad estás?',
        nextIntent: 'consulta_laboral',
        nextStep: 'ask_city',
      };
    }

    if (ai.intent === 'soporte') {
      return {
        patch: { intent: 'soporte', step: 'collecting_issue' },
        responseText: 'Entendido. Cuéntame cuál es el problema.',
        nextIntent: 'soporte',
        nextStep: 'collecting_issue',
      };
    }

    return {
      patch: {
        intent: context.intent ?? 'general',
        step: 'ask_intent',
      },
      responseText: 'Para ayudarte mejor, responde: laboral o soporte.',
      nextIntent: context.intent ?? 'general',
      nextStep: 'ask_intent',
    };
  }

  if (context.intent === 'consulta_laboral') {
    if (context.step === 'ask_city') {
      const city = cityFromAI ?? text.trim();
      return {
        patch: {
          intent: 'consulta_laboral',
          step: 'ask_age',
          profile: { city },
        },
        responseText: 'Gracias. ¿Cuál es tu edad?',
        nextIntent: 'consulta_laboral',
        nextStep: 'ask_age',
      };
    }

    if (context.step === 'ask_age') {
      const age = ageFromAI ?? parseAge(text);
      if (!age) {
        return {
          patch: {
            intent: 'consulta_laboral',
            step: 'ask_age',
          },
          responseText: '¿Me confirmas tu edad en números?',
          nextIntent: 'consulta_laboral',
          nextStep: 'ask_age',
        };
      }

      return {
        patch: {
          intent: 'consulta_laboral',
          step: 'ready_for_handoff',
          profile: { age },
        },
        responseText: 'Listo ✅ Ya tengo tu información. Te paso con un asesor.',
        nextIntent: 'consulta_laboral',
        nextStep: 'ready_for_handoff',
      };
    }
  }

  if (context.intent === 'soporte') {
    return {
      patch: {
        intent: 'soporte',
        step: 'ready_for_handoff',
        profile: { issue: text },
      },
      responseText: 'Perfecto. Ya registré tu caso. Te paso con un asesor.',
      nextIntent: 'soporte',
      nextStep: 'ready_for_handoff',
    };
  }

  return {
    patch: { intent: 'general', step: 'ask_intent' },
    responseText: 'Para ayudarte mejor, responde: laboral o soporte.',
    nextIntent: 'general',
    nextStep: 'ask_intent',
  };
}

export const orchestratorService = {
  async handleMessage(messageIn: MessageIn, requestId?: string): Promise<OrchestratorResponse> {
    const channel = mapChannel(messageIn.channel);
    const incomingType = mapMessageType(messageIn.message.type);
    const text = normalizeText(messageIn.message.text);

    const contact = await conversationClient.upsertContact({
      tenantId: messageIn.tenantId,
      channel,
      externalId: messageIn.externalUserId,
      displayName: messageIn.displayName,
      requestId,
    });

    const conversation = await conversationClient.getOrCreateConversation({
      tenantId: messageIn.tenantId,
      contactId: contact.id,
      channel,
      requestId,
    });

    await conversationClient.createMessage({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      contactId: contact.id,
      direction: 'IN',
      type: incomingType,
      text: messageIn.message.text,
      payload: messageIn.message.payload,
      providerMessageId: messageIn.message.providerMessageId,
      requestId,
    });

    const latestContext = await conversationClient.getLatestContext({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      requestId,
    });
    const context = parseContext(latestContext.data);

    let ai: AIResult;
    try {
      ai = await classifyExtract(messageIn.message.text ?? '');
    } catch (error) {
      log.warn(
        {
          requestId,
          tenantId: messageIn.tenantId,
          conversationId: conversation.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'AI classify failed, using fallback',
      );
      ai = localFallbackAI(text);
    }

    const decision = decideNextAction(text, context, ai);

    log.info(
      {
        requestId,
        tenantId: messageIn.tenantId,
        conversationId: conversation.id,
        stepBefore: context.step ?? null,
        intentBefore: context.intent ?? null,
        stepAfter: decision.nextStep,
        intentAfter: decision.nextIntent,
        shouldReset: ai.shouldReset ?? false,
      },
      'Orchestrator decision computed',
    );

    await conversationClient.patchContext({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      patch: decision.patch,
      requestId,
    });

    const responses: MessageOut[] = [{ type: 'text', text: decision.responseText }];

    await conversationClient.createMessage({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      contactId: contact.id,
      direction: 'OUT',
      type: 'TEXT',
      text: decision.responseText,
      payload: { orchestrator: true },
      requestId,
    });

    return {
      conversationId: conversation.id,
      contactId: contact.id,
      responses,
    };
  },
};
