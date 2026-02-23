import { Request, Response, NextFunction } from 'express';
import { ok } from '@sofia/shared-kernel';
import {
  CreateNotificationBody,
  CreateMessageBody,
  GetOrCreateConversationBody,
  PatchContextBody,
  UpsertContactBody,
} from '../dtos';
import { conversationService } from '../services/conversation.service';

function requireTenantId(req: Request): string {
  return req.tenantId as string;
}

export const conversationController = {
  async upsertContact(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as UpsertContactBody;
      const contact = await conversationService.upsertContact({
        tenantId: requireTenantId(req),
        channel: body.channel,
        externalId: body.externalId,
        displayName: body.displayName,
        phone: body.phone,
      });

      res.json(ok(contact));
    } catch (err) {
      next(err);
    }
  },

  async getOrCreateConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as GetOrCreateConversationBody;
      const conversation = await conversationService.getOrCreateConversation({
        tenantId: requireTenantId(req),
        contactId: body.contactId,
        channel: body.channel,
      });

      res.json(ok(conversation));
    } catch (err) {
      next(err);
    }
  },

  async createMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as CreateMessageBody;
      const message = await conversationService.createMessage({
        tenantId: requireTenantId(req),
        conversationId: body.conversationId,
        contactId: body.contactId,
        direction: body.direction,
        type: body.type,
        text: body.text,
        payload: body.payload,
        providerMessageId: body.providerMessageId,
      });

      res.json(ok(message));
    } catch (err) {
      next(err);
    }
  },

  async getLatestContext(req: Request, res: Response, next: NextFunction) {
    try {
      const conversationId = req.params.id as string;
      const context = await conversationService.getLatestContext(requireTenantId(req), conversationId);
      res.json(ok(context));
    } catch (err) {
      next(err);
    }
  },

  async patchContext(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as PatchContextBody;
      const conversationId = req.params.id as string;
      const result = await conversationService.patchContext(
        requireTenantId(req),
        conversationId,
        body.patch,
      );

      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  },

  async createNotification(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as CreateNotificationBody;
      const notification = await conversationService.createNotification({
        tipo: body.tipo,
        titulo: body.titulo,
        mensaje: body.mensaje,
        prioridad: body.prioridad,
        estudianteId: body.estudianteId,
      });

      res.json(ok(notification));
    } catch (err) {
      next(err);
    }
  },
};
