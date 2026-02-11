import { prisma, Cita, Caso, AreaDerecho, EstadoCaso, EstadoCita } from '@sofia/prisma';

// ─── Typed return interfaces ────────────────────────

interface CasoForEstudiante {
  id: string;
  descripcion: string | null;
  areaDerecho: AreaDerecho | null;
  estado: EstadoCaso;
}

interface CasoForAdmin extends CasoForEstudiante {
  creadoPorUsuarioId: string | null;
  creadoPor: { nombreCompleto: string } | null;
}

interface UsuarioSummary {
  id: string;
  nombreCompleto: string;
  correo: string;
}

export interface CitaForEstudiante extends Cita {
  caso: CasoForEstudiante;
}

export interface CitaForAdmin extends Cita {
  caso: CasoForAdmin;
}

export interface CasoWithCreador extends Caso {
  creadoPor: UsuarioSummary | null;
  citas: Cita[];
}

export interface CasoListItem extends Caso {
  creadoPor: UsuarioSummary | null;
  _count: { citas: number };
}

export interface EstadoCasoCount {
  estado: EstadoCaso;
  _count: { id: number };
}

// ─── Repository ─────────────────────────────────────

export const dashboardRepository = {
  /** Citas del estudiante (por usuarioId que creo el caso) */
  citasPorEstudiante(usuarioId: string, page: number, limit: number): Promise<[CitaForEstudiante[], number]> {
    const where = { caso: { creadoPorUsuarioId: usuarioId } };
    return Promise.all([
      prisma.cita.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { fechaHora: 'desc' },
        include: { caso: { select: { id: true, descripcion: true, areaDerecho: true, estado: true } } },
      }) as Promise<CitaForEstudiante[]>,
      prisma.cita.count({ where }),
    ]);
  },

  /** Todas las citas (para ADMIN) */
  todasLasCitas(page: number, limit: number): Promise<[CitaForAdmin[], number]> {
    return Promise.all([
      prisma.cita.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { fechaHora: 'desc' },
        include: {
          caso: {
            select: {
              id: true,
              descripcion: true,
              areaDerecho: true,
              estado: true,
              creadoPorUsuarioId: true,
              creadoPor: { select: { nombreCompleto: true } },
            },
          },
        },
      }) as Promise<CitaForAdmin[]>,
      prisma.cita.count(),
    ]);
  },

  /** Resumen agregado de casos por estado */
  async resumenCasos(): Promise<EstadoCasoCount[]> {
    const result = await prisma.caso.groupBy({ by: ['estado'], _count: { id: true } });
    return result as unknown as EstadoCasoCount[];
  },

  /** Caso individual con citas y creador */
  casoById(id: string): Promise<CasoWithCreador | null> {
    return prisma.caso.findUnique({
      where: { id },
      include: {
        citas: { orderBy: { fechaHora: 'desc' } },
        creadoPor: { select: { id: true, nombreCompleto: true, correo: true } },
      },
    }) as Promise<CasoWithCreador | null>;
  },

  /** Listado paginado de casos */
  listarCasos(page: number, limit: number, filters: { estado?: string; areaDerecho?: string }): Promise<[CasoListItem[], number]> {
    const where: Record<string, unknown> = {};
    if (filters.estado) where.estado = filters.estado;
    if (filters.areaDerecho) where.areaDerecho = filters.areaDerecho;

    return Promise.all([
      prisma.caso.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { creadoEn: 'desc' },
        include: {
          creadoPor: { select: { id: true, nombreCompleto: true, correo: true } },
          _count: { select: { citas: true } },
        },
      }) as Promise<CasoListItem[]>,
      prisma.caso.count({ where }),
    ]);
  },
};
