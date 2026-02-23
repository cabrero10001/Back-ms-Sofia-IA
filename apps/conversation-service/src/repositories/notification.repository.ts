import { Notificacion } from '../generated/prisma';
import { prisma } from '../db/prisma';

export const notificationRepository = {
  create(data: {
    tipo: string;
    titulo: string;
    mensaje: string;
    prioridad: string;
    estudianteId?: string;
  }): Promise<Notificacion> {
    return prisma.notificacion.create({
      data: {
        tipo: data.tipo,
        titulo: data.titulo,
        mensaje: data.mensaje,
        prioridad: data.prioridad,
        estudianteId: data.estudianteId,
      },
    });
  },
};
