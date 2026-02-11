import { Router } from 'express';
import { WhatsAppWebhookDto } from '@sofia/shared-kernel';
import { validate } from '../middlewares/validate';
import { whatsappController } from './whatsapp.controller';

export const whatsappRouter = Router();

// Webhook: recibe mensajes del proveedor WhatsApp
whatsappRouter.post('/webhook', validate(WhatsAppWebhookDto), whatsappController.webhook);

// Consulta de sesiones por teléfono (uso interno / dashboard)
whatsappRouter.get('/sesiones', whatsappController.sesiones);

// Historial de mensajes de una sesión (uso interno / dashboard)
whatsappRouter.get('/sesiones/:sesionId/mensajes', whatsappController.mensajes);
