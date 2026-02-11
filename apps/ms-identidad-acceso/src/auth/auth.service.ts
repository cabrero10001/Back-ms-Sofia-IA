import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config';
import { authRepository } from './auth.repository';
import {
  RegisterDto,
  LoginDto,
  JwtPayload,
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  Rol,
} from '@sofia/shared-kernel';

const SALT_ROUNDS = 10;

function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as any);
}

export const authService = {
  async register(dto: RegisterDto) {
    const existing = await authRepository.findByCorreo(dto.correo);
    if (existing) {
      throw new ConflictError(`El correo '${dto.correo}' ya está registrado`);
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const usuario = await authRepository.create({
      nombreCompleto: dto.nombreCompleto,
      correo: dto.correo,
      telefono: dto.telefono ?? null,
      passwordHash,
      rol: dto.rol as Rol,
    });

    const token = signToken({ sub: usuario.id, correo: usuario.correo, rol: usuario.rol as Rol });

    return {
      accessToken: token,
      usuario: {
        id: usuario.id,
        nombreCompleto: usuario.nombreCompleto,
        correo: usuario.correo,
        rol: usuario.rol,
      },
    };
  },

  async login(dto: LoginDto) {
    const usuario = await authRepository.findByCorreo(dto.correo);
    if (!usuario || !usuario.passwordHash) {
      throw new UnauthorizedError('Credenciales inválidas');
    }

    const valid = await bcrypt.compare(dto.password, usuario.passwordHash);
    if (!valid) {
      throw new UnauthorizedError('Credenciales inválidas');
    }

    const token = signToken({ sub: usuario.id, correo: usuario.correo, rol: usuario.rol as Rol });

    return {
      accessToken: token,
      usuario: {
        id: usuario.id,
        nombreCompleto: usuario.nombreCompleto,
        correo: usuario.correo,
        rol: usuario.rol,
      },
    };
  },

  async me(userId: string) {
    const usuario = await authRepository.findById(userId);
    if (!usuario) {
      throw new NotFoundError('Usuario', userId);
    }
    return usuario;
  },
};
