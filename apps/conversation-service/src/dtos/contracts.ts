import { z } from 'zod';

export const ContractChannelSchema = z.enum(['whatsapp', 'telegram', 'webchat']);
export const ContractMessageTypeSchema = z.enum(['text', 'image', 'audio', 'document', 'interactive']);
export const ContractConversationStatusSchema = z.enum(['OPEN', 'WAITING_INPUT', 'HANDOFF', 'CLOSED']);

export const MessageInSchema = z.object({
  tenantId: z.string().min(1),
  channel: ContractChannelSchema,
  externalUserId: z.string().min(1),
  displayName: z.string().min(1).optional(),
  message: z.object({
    type: ContractMessageTypeSchema,
    text: z.string().min(1).optional(),
    payload: z.record(z.any()).optional(),
    providerMessageId: z.string().min(1).optional(),
    timestamp: z.string().datetime().optional(),
  }),
});

export const MessageOutSchema = z.object({
  type: ContractMessageTypeSchema,
  text: z.string().optional(),
  payload: z.record(z.any()).optional(),
});

export const OrchestratorCommandSchema = z.object({
  messageIn: MessageInSchema,
});

export const SendMessagesActionSchema = z.object({
  kind: z.literal('SEND_MESSAGES'),
  messages: z.array(MessageOutSchema),
});

export const CallWebhookActionSchema = z.object({
  kind: z.literal('CALL_WEBHOOK'),
  url: z.string().url(),
  body: z.any(),
});

export const SetContextActionSchema = z.object({
  kind: z.literal('SET_CONTEXT'),
  patch: z.record(z.any()),
});

export const FlowExecutionResultSchema = z.object({
  nextStatus: ContractConversationStatusSchema,
  contextPatch: z.record(z.any()).optional(),
  actions: z.array(
    z.union([SendMessagesActionSchema, CallWebhookActionSchema, SetContextActionSchema]),
  ),
});

export type MessageIn = z.infer<typeof MessageInSchema>;
export type MessageOut = z.infer<typeof MessageOutSchema>;
export type OrchestratorCommand = z.infer<typeof OrchestratorCommandSchema>;
export type FlowExecutionResult = z.infer<typeof FlowExecutionResultSchema>;
