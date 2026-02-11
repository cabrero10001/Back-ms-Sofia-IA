import { Router } from 'express';
import { CreateCasoDto, UpdateCasoDto, UpdateEstadoCasoDto } from '@sofia/shared-kernel';
import { validate } from '../middlewares/validate';
import { casosController } from './casos.controller';

export const casosRouter = Router();

casosRouter.post('/', validate(CreateCasoDto), casosController.crear);
casosRouter.get('/', casosController.listar);
casosRouter.get('/:id', casosController.obtener);
casosRouter.patch('/:id', validate(UpdateCasoDto), casosController.actualizar);
casosRouter.patch('/:id/estado', validate(UpdateEstadoCasoDto), casosController.actualizarEstado);
casosRouter.delete('/:id', casosController.eliminar);
