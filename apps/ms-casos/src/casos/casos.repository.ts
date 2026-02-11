import { prisma, Caso, Cita, AreaDerecho, EstadoCaso, EstadoSesionChat } from '@sofia/prisma';

// ─── Typed return interfaces ────────────────────────

interface UsuarioSummary {
  id: string;
  nombreCompleto: string;
  correo: string;
}

interface UsuarioSummaryWithPhone extends UsuarioSummary {
  telefono: string | null;
}

interface SesionChatSummary {
  id: string;
  telefono: string;
  estado: EstadoSesionChat;
  iniciadaEn: Date;
  cerradaEn: Date | null;
}

export interface CasoWithCreador extends Caso {
  creadoPor: UsuarioSummary | null;
}

export interface CasoListItem extends Caso {
  creadoPor: UsuarioSummary | null;
  _count: { citas: number; sesionesChat: number };
}

export interface CasoDetail extends Caso {
  creadoPor: UsuarioSummaryWithPhone | null;
  citas: Cita[];
  sesionesChat: SesionChatSummary[];
}

// ─── Repository ─────────────────────────────────────

export const casosRepository = {
  create(data: {
    creadoPorUsuarioId?: string;
    telefonoContacto?: string;
    areaDerecho?: string;
    descripcion?: string;
  }): Promise<CasoWithCreador> {
    return prisma.caso.create({
      data: {
        ...(data.creadoPorUsuarioId
          ? { creadoPor: { connect: { id: data.creadoPorUsuarioId } } }
          : {}),
        telefonoContacto: data.telefonoContacto,
        areaDerecho: data.areaDerecho as AreaDerecho | undefined,
        descripcion: data.descripcion,
      },
      include: {
        creadoPor: { select: { id: true, nombreCompleto: true, correo: true } },
      },
    }) as Promise<CasoWithCreador>;
  },

  findMany(filters: {
    estado?: string;
    areaDerecho?: string;
    creadoPorUsuarioId?: string;
    page: number;
    limit: number;
  }): Promise<[CasoListItem[], number]> {
    const where: Record<string, unknown> = {};
    if (filters.estado) where.estado = filters.estado;
    if (filters.areaDerecho) where.areaDerecho = filters.areaDerecho;
    if (filters.creadoPorUsuarioId) where.creadoPorUsuarioId = filters.creadoPorUsuarioId;

    return Promise.all([
      prisma.caso.findMany({
        where,
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
        orderBy: { creadoEn: 'desc' },
        include: {
          creadoPor: { select: { id: true, nombreCompleto: true, correo: true } },
          _count: { select: { citas: true, sesionesChat: true } },
        },
      }) as Promise<CasoListItem[]>,
      prisma.caso.count({ where }),
    ]);
  },

  findById(id: string): Promise<CasoDetail | null> {
    return prisma.caso.findUnique({
      where: { id },
      include: {
        creadoPor: { select: { id: true, nombreCompleto: true, correo: true, telefono: true } },
        citas: {
          orderBy: { fechaHora: 'desc' },
          take: 10,
        },
        sesionesChat: {
          orderBy: { iniciadaEn: 'desc' },
          take: 5,
          select: { id: true, telefono: true, estado: true, iniciadaEn: true, cerradaEn: true },
        },
      },
    }) as Promise<CasoDetail | null>;
  },

  update(id: string, data: {
    telefonoContacto?: string;
    areaDerecho?: string;
    descripcion?: string;
    esCompetencia?: boolean;
    razonCompetencia?: string;
  }): Promise<CasoWithCreador> {
    const updateData: Record<string, unknown> = {};
    if (data.telefonoContacto !== undefined) updateData.telefonoContacto = data.telefonoContacto;
    if (data.areaDerecho !== undefined) updateData.areaDerecho = data.areaDerecho;
    if (data.descripcion !== undefined) updateData.descripcion = data.descripcion;
    if (data.esCompetencia !== undefined) updateData.esCompetencia = data.esCompetencia;
    if (data.razonCompetencia !== undefined) updateData.razonCompetencia = data.razonCompetencia;

    return prisma.caso.update({
      where: { id },
      data: updateData,
      include: {
        creadoPor: { select: { id: true, nombreCompleto: true, correo: true } },
      },
    }) as Promise<CasoWithCreador>;
  },

  updateEstado(id: string, estado: string): Promise<Caso> {
    return prisma.caso.update({
      where: { id },
      data: { estado: estado as EstadoCaso },
    });
  },

  delete(id: string): Promise<Caso> {
    return prisma.caso.delete({ where: { id } });
  },
};
