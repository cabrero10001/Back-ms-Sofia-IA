import { Router } from 'express';
import { CreateCitaDto, UpdateEstadoCitaDto } from '@sofia/shared-kernel';
import { validate } from '../middlewares/validate';
import { citasController } from './citas.controller';

export const citasRouter = Router();

citasRouter.post('/', validate(CreateCitaDto), citasController.crear);
citasRouter.get('/', citasController.listar);
citasRouter.get('/:id', citasController.obtener);
citasRouter.patch('/:id/estado', validate(UpdateEstadoCitaDto), citasController.actualizarEstado);
