// ─── API response wrapper ───────────────────────────
export interface ApiResponse<T> {
  data: T;
  error: null;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  data: null;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  error: null;
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Auth ───────────────────────────────────────────
export interface LoginPayload {
  correo: string;
  password: string;
}

export interface AuthUser {
  id: string;
  nombreCompleto: string;
  correo: string;
  telefono: string | null;
  rol: 'ADMIN_CONSULTORIO' | 'ESTUDIANTE' | 'USUARIO';
  estado: string;
  creadoEn: string;
}

export interface LoginResponse {
  accessToken: string;
  usuario: AuthUser;
}

// ─── Caso ───────────────────────────────────────────
export interface Caso {
  id: string;
  creadoPorUsuarioId: string | null;
  telefonoContacto: string | null;
  estado: 'ABIERTO' | 'EN_PROGRESO' | 'CERRADO' | 'DERIVADO';
  areaDerecho: string | null;
  descripcion: string | null;
  esCompetencia: boolean | null;
  razonCompetencia: string | null;
  creadoEn: string;
  actualizadoEn: string;
  creadoPor?: { id: string; nombreCompleto: string; correo: string } | null;
  _count?: { citas: number; sesionesChat: number };
  citas?: Cita[];
}

// ─── Cita ───────────────────────────────────────────
export interface Cita {
  id: string;
  casoId: string;
  fechaHora: string;
  estado: 'PROGRAMADA' | 'CONFIRMADA' | 'EN_CURSO' | 'COMPLETADA' | 'CANCELADA' | 'NO_ASISTIO';
  notas: string | null;
  creadoEn: string;
  actualizadoEn: string;
  caso?: { id: string; descripcion: string | null; areaDerecho: string | null };
}

// ─── Dashboard resumen ──────────────────────────────
export interface ResumenEstadoCaso {
  estado: string;
  _count: { id: number };
}

export interface DashboardResumen {
  casosPorEstado: ResumenEstadoCaso[];
}
