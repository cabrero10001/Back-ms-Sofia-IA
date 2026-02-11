import { prisma, Cita, Caso, AreaDerecho, EstadoCita } from '@sofia/prisma';

// ─── Typed return interfaces ────────────────────────

interface CasoSummary {
  id: string;
  descripcion: string | null;
  areaDerecho: AreaDerecho | null;
}

export interface CitaWithCasoSummary extends Cita {
  caso: CasoSummary;
}

export interface CitaWithCaso extends Cita {
  caso: Caso;
}

// ─── Repository ─────────────────────────────────────

export const citasRepository = {
  create(data: { casoId: string; fechaHora: Date; notas?: string }): Promise<Cita> {
    return prisma.cita.create({
      data: {
        caso: { connect: { id: data.casoId } },
        fechaHora: data.fechaHora,
        notas: data.notas,
      },
    });
  },

  findMany(filters: { casoId?: string; estado?: string; page: number; limit: number }): Promise<[CitaWithCasoSummary[], number]> {
    const where: Record<string, unknown> = {};
    if (filters.casoId) where.casoId = filters.casoId;
    if (filters.estado) where.estado = filters.estado;

    return Promise.all([
      prisma.cita.findMany({
        where,
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
        orderBy: { fechaHora: 'asc' },
        include: { caso: { select: { id: true, descripcion: true, areaDerecho: true } } },
      }) as Promise<CitaWithCasoSummary[]>,
      prisma.cita.count({ where }),
    ]);
  },

  findById(id: string): Promise<CitaWithCaso | null> {
    return prisma.cita.findUnique({
      where: { id },
      include: { caso: true },
    }) as Promise<CitaWithCaso | null>;
  },

  updateEstado(id: string, estado: string, notas?: string): Promise<Cita> {
    return prisma.cita.update({
      where: { id },
      data: { estado: estado as EstadoCita, ...(notas !== undefined ? { notas } : {}) },
    });
  },
};
