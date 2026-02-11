import { prisma, Estudiante, Rol } from '@sofia/prisma';

// ─── Typed return interfaces ────────────────────────

interface UsuarioSummary {
  id: string;
  nombreCompleto: string;
  correo: string;
  rol: Rol;
}

export interface EstudianteWithUsuario extends Estudiante {
  usuario: UsuarioSummary;
}

// ─── Repository ─────────────────────────────────────

export const estudiantesRepository = {
  create(data: { usuarioId: string; codigo?: string; programa: string; semestre?: number; activoConsultorio?: boolean }): Promise<EstudianteWithUsuario> {
    return prisma.estudiante.create({
      data: {
        usuario: { connect: { id: data.usuarioId } },
        codigo: data.codigo,
        programa: data.programa,
        semestre: data.semestre,
        activoConsultorio: data.activoConsultorio ?? false,
      },
      include: { usuario: { select: { id: true, nombreCompleto: true, correo: true, rol: true } } },
    }) as Promise<EstudianteWithUsuario>;
  },

  findMany(page: number, limit: number): Promise<[EstudianteWithUsuario[], number]> {
    return Promise.all([
      prisma.estudiante.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { creadoEn: 'desc' },
        include: { usuario: { select: { id: true, nombreCompleto: true, correo: true, rol: true } } },
      }) as Promise<EstudianteWithUsuario[]>,
      prisma.estudiante.count(),
    ]);
  },

  findById(id: string): Promise<EstudianteWithUsuario | null> {
    return prisma.estudiante.findUnique({
      where: { id },
      include: { usuario: { select: { id: true, nombreCompleto: true, correo: true, rol: true } } },
    }) as Promise<EstudianteWithUsuario | null>;
  },

  update(id: string, data: { codigo?: string; programa?: string; semestre?: number; activoConsultorio?: boolean }): Promise<EstudianteWithUsuario> {
    return prisma.estudiante.update({
      where: { id },
      data,
      include: { usuario: { select: { id: true, nombreCompleto: true, correo: true, rol: true } } },
    }) as Promise<EstudianteWithUsuario>;
  },

  delete(id: string): Promise<Estudiante> {
    return prisma.estudiante.delete({ where: { id } });
  },
};
