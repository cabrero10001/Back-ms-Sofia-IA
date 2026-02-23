import { ApiResponse, AppError } from '@sofia/shared-kernel';
import { serviceRequest } from '@sofia/http-client';
import { env } from '../config';
import { ConversationChannel, ConversationMessageType } from '../dtos';

interface ContactResponse {
  id: string;
  tenantId: string;
  channel: ConversationChannel;
  externalId: string;
  displayName: string | null;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ConversationResponse {
  id: string;
  tenantId: string;
  contactId: string;
  channel: ConversationChannel;
  status: 'OPEN' | 'WAITING_INPUT' | 'HANDOFF' | 'CLOSED';
  lastMessageAt: string;
  currentFlowVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MessageResponse {
  id: string;
  tenantId: string;
  conversationId: string;
  contactId: string;
  direction: 'IN' | 'OUT';
  type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'INTERACTIVE' | 'SYSTEM';
  text: string | null;
  payload: Record<string, unknown>;
  providerMessageId: string | null;
  createdAt: string;
}

interface ContextLatestResponse {
  version: number;
  data: Record<string, unknown>;
}

interface ContextPatchResponse {
  version: number;
  data: Record<string, unknown>;
}

interface NotificationResponse {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string;
  prioridad: string;
  leida: boolean;
  estudianteId: string | null;
  createdAt: string;
}

function extractData<T>(response: ApiResponse<T>): T {
  if (response.error) {
    throw new AppError(502, 'CONVERSATION_SERVICE_ERROR', response.error.message, response.error.details);
  }

  if (response.data === null) {
    throw new AppError(502, 'CONVERSATION_SERVICE_EMPTY_DATA', 'Respuesta vacía desde conversation-service');
  }

  return response.data;
}

async function safeRequest<T>(path: string, options: Parameters<typeof serviceRequest<T>>[2]): Promise<T> {
  try {
    return await serviceRequest<T>(env.CONVERSATION_SERVICE_URL, path, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fallo de comunicación con conversation-service';
    throw new AppError(502, 'CONVERSATION_SERVICE_UNAVAILABLE', message);
  }
}

export const conversationClient = {
  async upsertContact(input: {
    tenantId: string;
    channel: ConversationChannel;
    externalId: string;
    displayName?: string;
    requestId?: string;
  }): Promise<ContactResponse> {
    const res = await safeRequest<ApiResponse<ContactResponse>>('/v1/contacts/upsert', {
      method: 'POST',
      headers: {
        ...(input.requestId ? { 'X-Request-Id': input.requestId } : {}),
        'X-Tenant-Id': input.tenantId,
      },
      body: {
        tenantId: input.tenantId,
        channel: input.channel,
        externalId: input.externalId,
        displayName: input.displayName,
      },
    });

    return extractData(res);
  },

  async getOrCreateConversation(input: {
    tenantId: string;
    contactId: string;
    channel: ConversationChannel;
    requestId?: string;
  }): Promise<ConversationResponse> {
    const res = await safeRequest<ApiResponse<ConversationResponse>>(
      '/v1/conversations/get-or-create',
      {
        method: 'POST',
        headers: {
          ...(input.requestId ? { 'X-Request-Id': input.requestId } : {}),
          'X-Tenant-Id': input.tenantId,
        },
        body: {
          tenantId: input.tenantId,
          contactId: input.contactId,
          channel: input.channel,
        },
      },
    );

    return extractData(res);
  },

  async createMessage(input: {
    tenantId: string;
    conversationId: string;
    contactId: string;
    direction: 'IN' | 'OUT';
    type: ConversationMessageType;
    text?: string;
    payload?: Record<string, unknown>;
    providerMessageId?: string;
    requestId?: string;
  }): Promise<MessageResponse> {
    const res = await safeRequest<ApiResponse<MessageResponse>>('/v1/messages', {
      method: 'POST',
      headers: {
        ...(input.requestId ? { 'X-Request-Id': input.requestId } : {}),
        'X-Tenant-Id': input.tenantId,
      },
      body: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        direction: input.direction,
        type: input.type,
        text: input.text,
        payload: input.payload,
        providerMessageId: input.providerMessageId,
      },
    });

    return extractData(res);
  },

  async getLatestContext(input: {
    tenantId: string;
    conversationId: string;
    requestId?: string;
  }): Promise<ContextLatestResponse> {
    const query = new URLSearchParams({ tenantId: input.tenantId }).toString();
    const res = await safeRequest<ApiResponse<ContextLatestResponse>>(
      `/v1/conversations/${input.conversationId}/context/latest?${query}`,
      {
        method: 'GET',
        headers: {
          ...(input.requestId ? { 'X-Request-Id': input.requestId } : {}),
          'X-Tenant-Id': input.tenantId,
        },
      },
    );

    return extractData(res);
  },

  async patchContext(input: {
    tenantId: string;
    conversationId: string;
    patch: Record<string, unknown>;
    requestId?: string;
  }): Promise<ContextPatchResponse> {
    const res = await safeRequest<ApiResponse<ContextPatchResponse>>(
      `/v1/conversations/${input.conversationId}/context`,
      {
        method: 'POST',
        headers: {
          ...(input.requestId ? { 'X-Request-Id': input.requestId } : {}),
          'X-Tenant-Id': input.tenantId,
        },
        body: {
          tenantId: input.tenantId,
          patch: input.patch,
        },
      },
    );

    return extractData(res);
  },

  async createNotification(input: {
    tenantId: string;
    tipo: string;
    titulo: string;
    mensaje: string;
    prioridad: 'low' | 'medium' | 'high';
    estudianteId?: string;
    requestId?: string;
  }): Promise<NotificationResponse> {
    const res = await safeRequest<ApiResponse<NotificationResponse>>('/v1/notifications', {
      method: 'POST',
      headers: {
        ...(input.requestId ? { 'X-Request-Id': input.requestId } : {}),
        'X-Tenant-Id': input.tenantId,
      },
      body: {
        tenantId: input.tenantId,
        tipo: input.tipo,
        titulo: input.titulo,
        mensaje: input.mensaje,
        prioridad: input.prioridad,
        estudianteId: input.estudianteId,
      },
    });

    return extractData(res);
  },
};
