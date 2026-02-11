import { Router } from 'express';
import { CreateConsentimientoDto } from '@sofia/shared-kernel';
import { validate } from '../middlewares/validate';
import { consentimientosController } from './consentimientos.controller';

export const consentimientosRouter = Router();
consentimientosRouter.post('/', validate(CreateConsentimientoDto), consentimientosController.registrar);
consentimientosRouter.get('/telefono/:telefono', consentimientosController.porTelefono);
consentimientosRouter.get('/usuario/:usuarioId', consentimientosController.porUsuario);
