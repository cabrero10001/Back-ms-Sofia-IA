import { z } from 'zod';
import { Rol, EstadoCita, EstadoCaso, AreaDerecho } from './enums';

// ─── Auth ──────────────────────────────────────────
export const RegisterDto = z.object({
  nombreCompleto: z.string().min(2).max(200),
  correo: z.string().email(),
  telefono: z.string().min(7).max(20).optional(),
  password: z.string().min(8).max(128),
  rol: z.nativeEnum(Rol).default(Rol.USUARIO),
});
export type RegisterDto = z.infer<typeof RegisterDto>;

export const LoginDto = z.object({
  correo: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginDto>;

// ─── JWT payload (no-zod, interfaz interna) ────────
export interface JwtPayload {
  sub: string;
  correo: string;
  rol: Rol;
  iat?: number;
  exp?: number;
}

// ─── Estudiante ────────────────────────────────────
export const CreateEstudianteDto = z.object({
  usuarioId: z.string().uuid(),
  codigo: z.string().optional(),
  programa: z.string().min(2),
  semestre: z.number().int().min(1).max(20).optional(),
  activoConsultorio: z.boolean().default(false),
});
export type CreateEstudianteDto = z.infer<typeof CreateEstudianteDto>;

export const UpdateEstudianteDto = z.object({
  codigo: z.string().optional(),
  programa: z.string().min(2).optional(),
  semestre: z.number().int().min(1).max(20).optional(),
  activoConsultorio: z.boolean().optional(),
});
export type UpdateEstudianteDto = z.infer<typeof UpdateEstudianteDto>;

// ─── Cita ──────────────────────────────────────────
export const CreateCitaDto = z.object({
  casoId: z.string().uuid(),
  fechaHora: z.string().datetime(),
  notas: z.string().optional(),
});
export type CreateCitaDto = z.infer<typeof CreateCitaDto>;

export const UpdateEstadoCitaDto = z.object({
  estado: z.nativeEnum(EstadoCita),
  notas: z.string().optional(),
});
export type UpdateEstadoCitaDto = z.infer<typeof UpdateEstadoCitaDto>;

// ─── Caso ──────────────────────────────────────────
export const CreateCasoDto = z.object({
  telefonoContacto: z.string().optional(),
  areaDerecho: z.nativeEnum(AreaDerecho).optional(),
  descripcion: z.string().optional(),
});
export type CreateCasoDto = z.infer<typeof CreateCasoDto>;

export const UpdateCasoDto = z.object({
  telefonoContacto: z.string().optional(),
  areaDerecho: z.nativeEnum(AreaDerecho).optional(),
  descripcion: z.string().optional(),
  esCompetencia: z.boolean().optional(),
  razonCompetencia: z.string().optional(),
});
export type UpdateCasoDto = z.infer<typeof UpdateCasoDto>;

export const UpdateEstadoCasoDto = z.object({
  estado: z.nativeEnum(EstadoCaso),
});
export type UpdateEstadoCasoDto = z.infer<typeof UpdateEstadoCasoDto>;

// ─── Telegram webhook ──────────────────────────────
export const TelegramWebhookDto = z.object({
  telefono: z.string().min(7),
  mensaje: z.string().min(1),
  nombreContacto: z.string().optional(),
  messageId: z.string().optional(),
  timestamp: z.string().optional(),
});
export type TelegramWebhookDto = z.infer<typeof TelegramWebhookDto>;

// Backward compatibility
export const WhatsAppWebhookDto = TelegramWebhookDto;
export type WhatsAppWebhookDto = TelegramWebhookDto;

// ─── IA ────────────────────────────────────────────
export const IaRespondDto = z.object({
  telefono: z.string(),
  sesionId: z.string().uuid(),
  textoUsuario: z.string(),
  contexto: z.record(z.unknown()).optional(),
});
export type IaRespondDto = z.infer<typeof IaRespondDto>;

// ─── Consentimiento ────────────────────────────────
export const CreateConsentimientoDto = z.object({
  telefono: z.string().min(7).optional(),
  versionPolitica: z.string().min(1),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
});
export type CreateConsentimientoDto = z.infer<typeof CreateConsentimientoDto>;

// ─── Paginación ────────────────────────────────────
export const PaginationDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationDto = z.infer<typeof PaginationDto>;
