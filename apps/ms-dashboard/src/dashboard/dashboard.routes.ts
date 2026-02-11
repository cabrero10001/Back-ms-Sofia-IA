import { Router } from 'express';
import { dashboardController } from './dashboard.controller';

export const dashboardRouter = Router();

// Citas: ADMIN ve todas, ESTUDIANTE solo las suyas (filtrado por servicio)
dashboardRouter.get('/citas', dashboardController.citas);

// Resumen agregado (casos por estado)
dashboardRouter.get('/resumen', dashboardController.resumen);

// Listado paginado de casos (filtros: ?estado=ABIERTO&areaDerecho=CIVIL)
dashboardRouter.get('/casos', dashboardController.casos);

// Detalle de un caso con sus citas
dashboardRouter.get('/casos/:id', dashboardController.caso);
