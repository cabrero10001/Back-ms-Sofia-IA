// ─── Roles ─────────────────────────────────────────
export enum Rol {
  ADMIN_CONSULTORIO = 'ADMIN_CONSULTORIO',
  ESTUDIANTE = 'ESTUDIANTE',
  USUARIO = 'USUARIO',
}

// ─── Estado de usuario ─────────────────────────────
export enum EstadoUsuario {
  ACTIVO = 'ACTIVO',
  INACTIVO = 'INACTIVO',
  SUSPENDIDO = 'SUSPENDIDO',
}

// ─── Estado de caso ────────────────────────────────
export enum EstadoCaso {
  ABIERTO = 'ABIERTO',
  EN_PROGRESO = 'EN_PROGRESO',
  CERRADO = 'CERRADO',
  DERIVADO = 'DERIVADO',
}

// ─── Área de derecho ───────────────────────────────
export enum AreaDerecho {
  CIVIL = 'CIVIL',
  PENAL = 'PENAL',
  LABORAL = 'LABORAL',
  FAMILIA = 'FAMILIA',
  ADMINISTRATIVO = 'ADMINISTRATIVO',
  CONSTITUCIONAL = 'CONSTITUCIONAL',
  COMERCIAL = 'COMERCIAL',
  OTRO = 'OTRO',
}

// ─── Estado de cita ────────────────────────────────
export enum EstadoCita {
  PROGRAMADA = 'PROGRAMADA',
  CONFIRMADA = 'CONFIRMADA',
  EN_CURSO = 'EN_CURSO',
  COMPLETADA = 'COMPLETADA',
  CANCELADA = 'CANCELADA',
  NO_ASISTIO = 'NO_ASISTIO',
}

// ─── Sesión chat ───────────────────────────────────
export enum EstadoSesionChat {
  ACTIVA = 'ACTIVA',
  CERRADA = 'CERRADA',
  EXPIRADA = 'EXPIRADA',
}

// ─── Mensaje chat ──────────────────────────────────
export enum DireccionMensaje {
  ENTRANTE = 'ENTRANTE',
  SALIENTE = 'SALIENTE',
}

export enum RolMensaje {
  USUARIO = 'USUARIO',
  ASISTENTE = 'ASISTENTE',
  SISTEMA = 'SISTEMA',
}

// ─── Consentimiento ────────────────────────────────
export enum TipoConsentimiento {
  TRATAMIENTO_DATOS = 'TRATAMIENTO_DATOS',
  TERMINOS_SERVICIO = 'TERMINOS_SERVICIO',
  POLITICA_PRIVACIDAD = 'POLITICA_PRIVACIDAD',
}
