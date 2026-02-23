import {
  Channel,
  Contact,
  Conversation,
  ConversationContext,
  Direction,
  Message,
  MessageType,
  Prisma,
} from '../generated/prisma';
import { AppError, NotFoundError } from '@sofia/shared-kernel';
import {
  contactRepository,
  contextRepository,
  conversationRepository,
  messageRepository,
  notificationRepository,
} from '../repositories';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    const previous = output[key];

    if (isPlainObject(previous) && isPlainObject(value)) {
      output[key] = deepMerge(previous, value);
      continue;
    }

    output[key] = value;
  }

  return output;
}

export const conversationService = {
  upsertContact(input: {
    tenantId: string;
    channel: Channel;
    externalId: string;
    displayName?: string;
    phone?: string;
  }): Promise<Contact> {
    return contactRepository.upsert(input);
  },

  async getOrCreateConversation(input: {
    tenantId: string;
    contactId: string;
    channel: Channel;
  }): Promise<Conversation> {
    const contact = await contactRepository.findById(input.tenantId, input.contactId);
    if (!contact) {
      throw new NotFoundError('Contacto', input.contactId);
    }

    const active = await conversationRepository.findActiveByContact(
      input.tenantId,
      input.contactId,
      input.channel,
    );

    if (active) return active;

    return conversationRepository.create(input.tenantId, input.contactId, input.channel);
  },

  async createMessage(input: {
    tenantId: string;
    conversationId: string;
    contactId: string;
    direction: Direction;
    type: MessageType;
    text?: string;
    payload?: Record<string, unknown>;
    providerMessageId?: string;
  }): Promise<Message> {
    const conversation = await conversationRepository.findById(input.tenantId, input.conversationId);
    if (!conversation) {
      throw new NotFoundError('Conversación', input.conversationId);
    }

    const contact = await contactRepository.findById(input.tenantId, input.contactId);
    if (!contact) {
      throw new NotFoundError('Contacto', input.contactId);
    }

    if (conversation.contactId !== input.contactId) {
      throw new AppError(
        409,
        'CONTACT_CONVERSATION_MISMATCH',
        'El contacto no corresponde a la conversación indicada',
      );
    }

    if (input.providerMessageId) {
      const existing = await messageRepository.findByProviderMessageId(
        input.tenantId,
        input.providerMessageId,
      );

      if (existing) return existing;
    }

    return messageRepository.createAndTouchConversation({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      direction: input.direction,
      type: input.type,
      text: input.text,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      providerMessageId: input.providerMessageId,
    });
  },

  async getLatestContext(tenantId: string, conversationId: string): Promise<{ version: number; data: Record<string, unknown> }> {
    const conversation = await conversationRepository.findById(tenantId, conversationId);
    if (!conversation) {
      throw new NotFoundError('Conversación', conversationId);
    }

    const latest = await contextRepository.findLatest(tenantId, conversationId);
    if (!latest) return { version: 0, data: {} };

    const data = isPlainObject(latest.data) ? latest.data : {};
    return { version: latest.version, data };
  },

  async patchContext(
    tenantId: string,
    conversationId: string,
    patch: Record<string, unknown>,
  ): Promise<{ version: number; data: Record<string, unknown> }> {
    const conversation = await conversationRepository.findById(tenantId, conversationId);
    if (!conversation) {
      throw new NotFoundError('Conversación', conversationId);
    }

    const latest = await contextRepository.findLatest(tenantId, conversationId);
    const baseData = latest && isPlainObject(latest.data) ? latest.data : {};
    const nextData = deepMerge(baseData, patch);

    const created: ConversationContext = await contextRepository.createNextVersion(
      tenantId,
      conversationId,
      nextData as Prisma.InputJsonValue,
    );

    return {
      version: created.version,
      data: nextData,
    };
  },

  createNotification(input: {
    tipo: string;
    titulo: string;
    mensaje: string;
    prioridad: 'low' | 'medium' | 'high';
    estudianteId?: string;
  }) {
    return notificationRepository.create(input);
  },
};
