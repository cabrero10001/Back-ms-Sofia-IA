import { prisma, Usuario, Rol, EstadoUsuario } from '@sofia/prisma';

// ─── Typed interfaces ───────────────────────────────

export interface CreateUsuarioData {
  nombreCompleto: string;
  correo: string;
  telefono?: string | null;
  passwordHash: string;
  rol?: Rol;
  estado?: EstadoUsuario;
}

export interface UsuarioPublic {
  id: string;
  nombreCompleto: string;
  correo: string;
  telefono: string | null;
  rol: Rol;
  estado: EstadoUsuario;
  creadoEn: Date;
}

// ─── Repository ─────────────────────────────────────

export const authRepository = {
  findByCorreo(correo: string): Promise<Usuario | null> {
    return prisma.usuario.findUnique({ where: { correo } });
  },

  findById(id: string): Promise<UsuarioPublic | null> {
    return prisma.usuario.findUnique({
      where: { id },
      select: {
        id: true,
        nombreCompleto: true,
        correo: true,
        telefono: true,
        rol: true,
        estado: true,
        creadoEn: true,
      },
    }) as Promise<UsuarioPublic | null>;
  },

  create(data: CreateUsuarioData): Promise<Usuario> {
    return prisma.usuario.create({ data });
  },
};
