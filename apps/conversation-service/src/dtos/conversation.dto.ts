import { Channel, Direction, MessageType } from '../generated/prisma';
import { z } from 'zod';

const TenantId = z.string().min(1);

export const UpsertContactBodyDto = z.object({
  tenantId: TenantId,
  channel: z.nativeEnum(Channel),
  externalId: z.string().min(1),
  displayName: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
});

export const GetOrCreateConversationBodyDto = z.object({
  tenantId: TenantId,
  contactId: z.string().uuid(),
  channel: z.nativeEnum(Channel),
});

export const CreateMessageBodyDto = z.object({
  tenantId: TenantId,
  conversationId: z.string().uuid(),
  contactId: z.string().uuid(),
  direction: z.nativeEnum(Direction),
  type: z.nativeEnum(MessageType),
  text: z.string().optional(),
  payload: z.record(z.any()).default({}),
  providerMessageId: z.string().min(1).optional(),
});

export const ConversationParamsDto = z.object({
  id: z.string().uuid(),
});

export const LatestContextQueryDto = z.object({
  tenantId: TenantId,
});

export const PatchContextBodyDto = z.object({
  tenantId: TenantId,
  patch: z.record(z.any()),
});

export const CreateNotificationBodyDto = z.object({
  tenantId: TenantId,
  tipo: z.string().min(1),
  titulo: z.string().min(1),
  mensaje: z.string().min(1),
  prioridad: z.enum(['low', 'medium', 'high']).default('medium'),
  estudianteId: z.string().optional(),
});

export type UpsertContactBody = z.infer<typeof UpsertContactBodyDto>;
export type GetOrCreateConversationBody = z.infer<typeof GetOrCreateConversationBodyDto>;
export type CreateMessageBody = z.infer<typeof CreateMessageBodyDto>;
export type PatchContextBody = z.infer<typeof PatchContextBodyDto>;
export type CreateNotificationBody = z.infer<typeof CreateNotificationBodyDto>;
