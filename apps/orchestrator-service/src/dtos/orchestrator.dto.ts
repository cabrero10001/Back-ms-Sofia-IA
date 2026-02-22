import { z } from 'zod';

export const MessageChannelSchema = z.enum(['whatsapp', 'telegram', 'webchat']);
export const MessageTypeSchema = z.enum(['text', 'image', 'audio', 'document', 'interactive']);

export const MessageInSchema = z.object({
  tenantId: z.string().min(1),
  channel: MessageChannelSchema,
  externalUserId: z.string().min(1),
  displayName: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  message: z.preprocess(
    (value) => {
      if (typeof value === 'string') {
        return { type: 'text', message: value };
      }
      return value;
    },
    z.object({
      type: MessageTypeSchema,
      text: z.union([
        z.string().min(1),
        z.object({
          body: z.string().min(1),
        }),
      ]).optional(),
      message: z.string().min(1).optional(),
      body: z.string().min(1).optional(),
      payload: z.record(z.any()).optional(),
      providerMessageId: z.string().min(1).optional(),
      timestamp: z.string().datetime().optional(),
    }),
  ),
});

export const MessageOutSchema = z.object({
  type: MessageTypeSchema,
  text: z.string().optional(),
  payload: z.record(z.any()).optional(),
});

export const OrchestratorResponseSchema = z.object({
  conversationId: z.string().uuid(),
  contactId: z.string().uuid(),
  correlationId: z.string().min(1).optional(),
  responses: z.array(MessageOutSchema),
});

export type MessageIn = z.infer<typeof MessageInSchema>;
export type MessageOut = z.infer<typeof MessageOutSchema>;
export type OrchestratorResponse = z.infer<typeof OrchestratorResponseSchema>;

export type ConversationChannel = 'WHATSAPP' | 'WEBCHAT';
export type ConversationMessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'INTERACTIVE';
