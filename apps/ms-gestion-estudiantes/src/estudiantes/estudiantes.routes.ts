import { Router } from 'express';
import { CreateEstudianteDto, UpdateEstudianteDto, Rol } from '@sofia/shared-kernel';
import { validate } from '../middlewares/validate';
import { requireInternalRole } from '../middlewares/require-role';
import { estudiantesController } from './estudiantes.controller';

export const estudiantesRouter = Router();

// Todas las rutas requieren rol ADMIN_CONSULTORIO (defensa en profundidad)
estudiantesRouter.use(requireInternalRole(Rol.ADMIN_CONSULTORIO));

estudiantesRouter.post('/', validate(CreateEstudianteDto), estudiantesController.crear);
estudiantesRouter.get('/', estudiantesController.listar);
estudiantesRouter.get('/:id', estudiantesController.obtener);
estudiantesRouter.patch('/:id', validate(UpdateEstudianteDto), estudiantesController.actualizar);
estudiantesRouter.delete('/:id', estudiantesController.eliminar);
