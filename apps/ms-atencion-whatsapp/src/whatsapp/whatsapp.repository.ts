import { prisma, SesionChat, MensajeChat, EstadoSesionChat, DireccionMensaje, RolMensaje } from '@sofia/prisma';

// ─── Typed return interfaces ────────────────────────

export interface SesionChatWithCount extends SesionChat {
  _count: { mensajes: number };
}

// ─── Repository ─────────────────────────────────────

export const whatsappRepository = {
  async findOrCreateSesion(telefono: string): Promise<SesionChat> {
    let sesion = await prisma.sesionChat.findFirst({
      where: { telefono, estado: EstadoSesionChat.ACTIVA },
      orderBy: { iniciadaEn: 'desc' },
    });
    if (!sesion) {
      sesion = await prisma.sesionChat.create({
        data: { telefono, estado: EstadoSesionChat.ACTIVA },
      });
    }
    return sesion;
  },

  guardarMensaje(data: {
    sesionId: string;
    direccion: DireccionMensaje;
    rol: RolMensaje;
    texto: string;
  }): Promise<MensajeChat> {
    return prisma.mensajeChat.create({
      data: {
        sesion: { connect: { id: data.sesionId } },
        direccion: data.direccion,
        rol: data.rol,
        texto: data.texto,
      },
    });
  },

  findSesionesByTelefono(telefono: string): Promise<SesionChatWithCount[]> {
    return prisma.sesionChat.findMany({
      where: { telefono },
      orderBy: { iniciadaEn: 'desc' },
      take: 20,
      include: { _count: { select: { mensajes: true } } },
    }) as Promise<SesionChatWithCount[]>;
  },

  findMensajesBySesion(sesionId: string): Promise<MensajeChat[]> {
    return prisma.mensajeChat.findMany({
      where: { sesionId },
      orderBy: { creadoEn: 'asc' },
    });
  },
};
