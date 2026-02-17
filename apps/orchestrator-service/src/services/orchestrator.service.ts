import { createLogger } from '@sofia/observability';
import { randomUUID } from 'crypto';
import { classifyExtract, type AIResult } from '../clients/aiServiceClient';
import { askRag, type RagAnswerResult } from '../clients/ragClient';
import { conversationClient } from '../clients/conversation.client';
import { env } from '../config';
import { ConversationStore, type ConversationState } from './conversationStore';
import {
  ConversationChannel,
  ConversationMessageType,
  MessageIn,
  MessageOut,
  OrchestratorResponse,
} from '../dtos';

const log = createLogger('orchestrator-service-logic');
const conversationStore = new ConversationStore(env.ORCH_CONV_TTL_MIN * 60_000);

type Intent = 'general' | 'consulta_laboral' | 'consulta_juridica' | 'soporte';
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

const RAG_NO_SUPPORT_FALLBACK =
  'No encontré esa información en el documento. ¿Puedes dar más detalles (tipo de contrato, tiempo laborado, ciudad/país, y qué ocurrió)?';

const RAG_ERROR_FALLBACK =
  'En este momento no pude consultar la base jurídica. Por favor cuéntame más contexto y lo intento de nuevo.';

const MENU_TEXT = 'Hola 👋 ¿En qué te ayudo hoy?\n1) Laboral\n2) Soporte';

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

function extractText(input: unknown): string {
  const payload = input as {
    text?: unknown;
    message?: {
      message?: unknown;
      text?: unknown;
      body?: unknown;
    };
  };

  const pick = (
    typeof payload?.text === 'string' && payload.text.trim().length > 0
      ? payload.text
      : typeof payload?.message?.message === 'string' && payload.message.message.trim().length > 0
        ? payload.message.message
        : typeof payload?.message?.text === 'string' && payload.message.text.trim().length > 0
          ? payload.message.text
          : typeof payload?.message?.body === 'string' && payload.message.body.trim().length > 0
            ? payload.message.body
            : ''
  );

  return pick.trim().toLowerCase();
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

function normalizeIntent(intent: string | undefined): Intent {
  if (intent === 'consulta_juridica') return 'consulta_laboral';
  if (intent === 'consulta_laboral' || intent === 'soporte' || intent === 'general') return intent;
  return 'general';
}

function buildConversationKey(input: MessageIn): string {
  return `${input.tenantId}:${input.channel}:${input.externalUserId}`;
}

function isResetCommand(text: string): boolean {
  return ['reset', 'reiniciar', 'menu', 'menú', 'inicio', 'empezar'].includes(text);
}

function isLaboralSelection(text: string): boolean {
  return text === '1' || text.includes('laboral') || text.includes('jurid') || text.includes('trabajo');
}

function isSoporteSelection(text: string): boolean {
  return text === '2' || text.includes('soporte') || text.includes('problema') || text.includes('error');
}

function defaultState(): Omit<ConversationState, 'updatedAt' | 'expiresAt'> {
  return {
    stage: 'awaiting_category',
    category: undefined,
    profile: {},
  };
}

type StatefulFlowResult = {
  responseText: string;
  patch: Record<string, unknown>;
  payload: Record<string, unknown>;
};

async function resolveLaboralQuery(input: {
  rawText: string;
  correlationId: string;
  tenantId: string;
  conversationId: string;
}): Promise<{ responseText: string; payload: Record<string, unknown> }> {
  const query = input.rawText.trim();
  if (!query) {
    return {
      responseText: 'Escribe tu consulta laboral para ayudarte mejor.',
      payload: { rag: { status: 'empty_query' }, correlationId: input.correlationId },
    };
  }

  const ragStartedAt = Date.now();
  try {
    const ragResult = await askRag(query, input.correlationId);
    const isNoSupport = isRagNoSupport(ragResult);
    const responseText = isNoSupport ? RAG_NO_SUPPORT_FALLBACK : buildRagWhatsappText(ragResult);

    log.info(
      {
        correlationId: input.correlationId,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        intent: 'consulta_laboral',
        queryLen: query.length,
        querySample: query.slice(0, 40),
        ragLatencyMs: Date.now() - ragStartedAt,
        ragStatusCode: ragResult.statusCode,
      },
      'RAG response integrated (stateful flow)',
    );

    return {
      responseText,
      payload: {
        correlationId: input.correlationId,
        rag: {
          statusCode: ragResult.statusCode,
          latencyMs: ragResult.latencyMs,
          citationsCount: ragResult.citations.length,
          usedChunksCount: ragResult.usedChunks.length,
          noSupport: isNoSupport,
        },
      },
    };
  } catch (error) {
    log.warn(
      {
        correlationId: input.correlationId,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        intent: 'consulta_laboral',
        queryLen: query.length,
        querySample: query.slice(0, 40),
        error: error instanceof Error ? error.message : String(error),
      },
      'RAG call failed in stateful flow',
    );

    return {
      responseText: RAG_ERROR_FALLBACK,
      payload: {
        correlationId: input.correlationId,
        rag: {
          status: 'error',
          latencyMs: Date.now() - ragStartedAt,
          error: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}

async function runStatefulFlow(input: {
  messageIn: MessageIn;
  text: string;
  rawText: string;
  conversationId: string;
  correlationId: string;
}): Promise<StatefulFlowResult> {
  const key = buildConversationKey(input.messageIn);

  if (isResetCommand(input.text)) {
    conversationStore.clear(key);
    conversationStore.set(key, defaultState());
    return {
      responseText: MENU_TEXT,
      patch: { intent: 'general', step: 'ask_intent', profile: {} },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', reset: true },
    };
  }

  const state = conversationStore.get(key) ?? conversationStore.set(key, defaultState());

  if (state.stage === 'awaiting_category') {
    if (isLaboralSelection(input.text)) {
      conversationStore.set(key, { stage: 'awaiting_question', category: 'laboral', profile: state.profile ?? {} });
      return {
        responseText: 'Perfecto. Escribe tu consulta laboral y te respondo con base en el documento.',
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile: state.profile ?? {} },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', category: 'laboral' },
      };
    }

    if (isSoporteSelection(input.text)) {
      conversationStore.set(key, { stage: 'support', category: 'soporte', profile: state.profile ?? {} });
      return {
        responseText: 'Perfecto. Describe tu problema de soporte para ayudarte.',
        patch: { intent: 'soporte', step: 'collecting_issue', profile: state.profile ?? {} },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', category: 'soporte' },
      };
    }

    return {
      responseText: MENU_TEXT,
      patch: { intent: 'general', step: 'ask_intent', profile: state.profile ?? {} },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', category: 'unknown' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_question') {
    if (!env.ORCH_RAG_ENABLED) {
      return {
        responseText: 'El modo de consulta jurídica está desactivado temporalmente. Intenta en unos minutos.',
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile: state.profile ?? {} },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', ragEnabled: false },
      };
    }

    const rag = await resolveLaboralQuery({
      rawText: input.rawText,
      correlationId: input.correlationId,
      tenantId: input.messageIn.tenantId,
      conversationId: input.conversationId,
    });

    conversationStore.set(key, { stage: 'awaiting_question', category: 'laboral', profile: state.profile ?? {} });
    return {
      responseText: rag.responseText,
      patch: { intent: 'consulta_laboral', step: 'ask_issue', profile: state.profile ?? {} },
      payload: { orchestrator: true, flow: 'stateful', ...rag.payload },
    };
  }

  if (state.category === 'soporte' || state.stage === 'support') {
    conversationStore.set(key, { stage: 'support', category: 'soporte', profile: { issue: input.rawText.trim() } });
    return {
      responseText: 'Gracias. Registré tu caso de soporte y te ayudaré con un asesor. Si deseas empezar de nuevo escribe reset.',
      patch: { intent: 'soporte', step: 'collecting_issue', profile: { issue: input.rawText.trim() } },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', category: 'soporte' },
    };
  }

  conversationStore.set(key, defaultState());
  return {
    responseText: MENU_TEXT,
    patch: { intent: 'general', step: 'ask_intent', profile: {} },
    payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', fallback: true },
  };
}

export async function __testOnly_runStatefulFlow(input: {
  messageIn: MessageIn;
  conversationId: string;
  correlationId: string;
}): Promise<StatefulFlowResult> {
  const extractedText = extractText(input.messageIn);
  return runStatefulFlow({
    messageIn: input.messageIn,
    text: extractedText,
    rawText: extractedText,
    conversationId: input.conversationId,
    correlationId: input.correlationId,
  });
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

function isHardResetCommand(text: string): boolean {
  return [
    'reset',
    'reiniciar',
    'menu',
    'menú',
    'inicio',
    'empezar',
    'comenzar',
  ].includes(text);
}

function isGreeting(text: string): boolean {
  return [
    'hola',
    'holi',
    'buenas',
    'hello',
    'hi',
  ].includes(text);
}

function decideNextAction(text: string, context: OrchestratorContext, ai: AIResult): Decision {
  const shouldForceReset = isHardResetCommand(text)
    || (isGreeting(text) && context.step === 'ready_for_handoff');

  if (ai.shouldReset === true || shouldForceReset) {
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
    if (normalizeIntent(ai.intent) === 'consulta_laboral') {
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

    if (normalizeIntent(ai.intent) === 'soporte') {
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

function shouldUseRag(intent: Intent, text: string): boolean {
  if (!env.ORCH_RAG_ENABLED) return false;
  if (intent !== 'consulta_laboral' && intent !== 'consulta_juridica') return false;
  return text.trim().length > 0;
}

function isRagNoSupport(result: RagAnswerResult): boolean {
  const answer = result.answer.trim().toLowerCase();
  if (answer.includes('no encontre suficiente soporte')) return true;
  return result.citations.length === 0 && result.usedChunks.length === 0;
}

function truncateForWhatsapp(text: string, max = 1300): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function buildSourcesSection(result: RagAnswerResult): string {
  if (!result.citations.length) return '';
  const list = result.citations.slice(0, 3).map((citation, idx) => {
    const source = citation.source ?? 'doc';
    const chunk = typeof citation.chunkIndex === 'number' ? citation.chunkIndex : 0;
    return `(${idx + 1}) ${source} frag ${chunk}`;
  });
  return `\n\nFuentes: ${list.join(' | ')}`;
}

function buildRagWhatsappText(result: RagAnswerResult): string {
  const base = truncateForWhatsapp(result.answer.trim());
  const sources = buildSourcesSection(result);
  return truncateForWhatsapp(`${base}${sources}`);
}

export const orchestratorService = {
  async handleMessage(messageIn: MessageIn, requestId?: string): Promise<OrchestratorResponse> {
    const correlationId = requestId ?? randomUUID();
    const channel = mapChannel(messageIn.channel);
    const incomingType = mapMessageType(messageIn.message.type);
    const extractedText = extractText(messageIn);

    const contact = await conversationClient.upsertContact({
      tenantId: messageIn.tenantId,
      channel,
      externalId: messageIn.externalUserId,
      displayName: messageIn.displayName,
      requestId: correlationId,
    });

    const conversation = await conversationClient.getOrCreateConversation({
      tenantId: messageIn.tenantId,
      contactId: contact.id,
      channel,
      requestId: correlationId,
    });

    await conversationClient.createMessage({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      contactId: contact.id,
      direction: 'IN',
      type: incomingType,
      text: extractedText,
      payload: messageIn.message.payload,
      providerMessageId: messageIn.message.providerMessageId,
      requestId: correlationId,
    });

    const latestContext = await conversationClient.getLatestContext({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      requestId: correlationId,
    });
    const context = parseContext(latestContext.data);

    let ai: AIResult = localFallbackAI(extractedText);
    let patch: Record<string, unknown>;
    let responseText = '';
    let responsePayload: Record<string, unknown> = { orchestrator: true, correlationId };
    let nextIntent: Intent = 'general';
    let nextStep: Step = 'ask_intent';

    if (env.ORCH_FLOW_MODE === 'stateful') {
      const statefulResult = await runStatefulFlow({
        messageIn,
        text: extractedText,
        rawText: extractedText,
        conversationId: conversation.id,
        correlationId,
      });
      responseText = statefulResult.responseText;
      responsePayload = statefulResult.payload;
      patch = statefulResult.patch;
      nextIntent = normalizeIntent(typeof patch.intent === 'string' ? patch.intent : 'general');
      nextStep = typeof patch.step === 'string' ? (patch.step as Step) : 'ask_intent';
    } else {
      try {
        ai = await classifyExtract(extractedText);
      } catch (error) {
        log.warn(
          {
            requestId: correlationId,
            tenantId: messageIn.tenantId,
            conversationId: conversation.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'AI classify failed, using fallback',
        );
        ai = localFallbackAI(extractedText);
      }

      const decision = decideNextAction(extractedText, context, ai);
      patch = decision.patch;
      responseText = decision.responseText;
      responsePayload = { orchestrator: true, correlationId };
      nextIntent = decision.nextIntent;
      nextStep = decision.nextStep;

      const intentForRag = normalizeIntent(decision.nextIntent);
      if (shouldUseRag(intentForRag, extractedText)) {
        const ragStartedAt = Date.now();
        const query = extractedText.trim();

        try {
          const ragResult = await askRag(query, correlationId);
          const isNoSupport = isRagNoSupport(ragResult);
          responseText = isNoSupport ? RAG_NO_SUPPORT_FALLBACK : buildRagWhatsappText(ragResult);
          responsePayload = {
            ...responsePayload,
            rag: {
              statusCode: ragResult.statusCode,
              latencyMs: ragResult.latencyMs,
              citationsCount: ragResult.citations.length,
              usedChunksCount: ragResult.usedChunks.length,
              topChunk: ragResult.usedChunks[0]?.chunkIndex ?? null,
              noSupport: isNoSupport,
            },
          };

          log.info(
            {
              correlationId,
              tenantId: messageIn.tenantId,
              conversationId: conversation.id,
              intent: intentForRag,
              queryLen: query.length,
              querySample: query.slice(0, 40),
              ragLatencyMs: Date.now() - ragStartedAt,
              ragStatusCode: ragResult.statusCode,
            },
            'RAG response integrated',
          );
        } catch (error) {
          responseText = RAG_ERROR_FALLBACK;
          responsePayload = {
            ...responsePayload,
            rag: {
              status: 'error',
              latencyMs: Date.now() - ragStartedAt,
              error: error instanceof Error ? error.message : String(error),
            },
          };

          log.warn(
            {
              correlationId,
              tenantId: messageIn.tenantId,
              conversationId: conversation.id,
              intent: intentForRag,
              queryLen: query.length,
              querySample: query.slice(0, 40),
              error: error instanceof Error ? error.message : String(error),
            },
            'RAG call failed, fallback response used',
          );
        }
      }
    }

    log.info(
      {
        requestId: correlationId,
        correlationId,
        tenantId: messageIn.tenantId,
        conversationId: conversation.id,
        stepBefore: context.step ?? null,
        intentBefore: context.intent ?? null,
        stepAfter: nextStep,
        intentAfter: nextIntent,
        extractedText,
        category: (responsePayload.category as string | undefined)
          ?? (nextIntent === 'consulta_laboral' ? 'laboral' : nextIntent === 'soporte' ? 'soporte' : null),
        flowMode: env.ORCH_FLOW_MODE,
        shouldReset: ai.shouldReset ?? false,
      },
      'Orchestrator decision computed',
    );

    await conversationClient.patchContext({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      patch,
      requestId: correlationId,
    });

    const responses: MessageOut[] = [{ type: 'text', text: responseText, payload: responsePayload }];

    await conversationClient.createMessage({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      contactId: contact.id,
      direction: 'OUT',
      type: 'TEXT',
      text: responseText,
      payload: responsePayload,
      requestId: correlationId,
    });

    return {
      conversationId: conversation.id,
      contactId: contact.id,
      correlationId,
      responses,
    };
  },
};
