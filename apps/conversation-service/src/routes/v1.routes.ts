import { Router } from 'express';
import { conversationController } from '../controllers/conversation.controller';
import {
  ConversationParamsDto,
  CreateNotificationBodyDto,
  CreateMessageBodyDto,
  GetOrCreateConversationBodyDto,
  LatestContextQueryDto,
  PatchContextBodyDto,
  UpsertContactBodyDto,
} from '../dtos';
import { requireTenantScope } from '../middlewares/tenant-scope';
import { validate } from '../middlewares/validate';

export const v1Router = Router();

v1Router.use(requireTenantScope);

v1Router.post(
  '/contacts/upsert',
  validate({ body: UpsertContactBodyDto }),
  conversationController.upsertContact,
);

v1Router.post(
  '/conversations/get-or-create',
  validate({ body: GetOrCreateConversationBodyDto }),
  conversationController.getOrCreateConversation,
);

v1Router.post(
  '/messages',
  validate({ body: CreateMessageBodyDto }),
  conversationController.createMessage,
);

v1Router.post(
  '/notifications',
  validate({ body: CreateNotificationBodyDto }),
  conversationController.createNotification,
);

v1Router.get(
  '/conversations/:id/context/latest',
  validate({ params: ConversationParamsDto, query: LatestContextQueryDto }),
  conversationController.getLatestContext,
);

v1Router.post(
  '/conversations/:id/context',
  validate({ params: ConversationParamsDto, body: PatchContextBodyDto }),
  conversationController.patchContext,
);
