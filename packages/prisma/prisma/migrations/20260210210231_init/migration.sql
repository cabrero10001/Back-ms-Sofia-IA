-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ADMIN_CONSULTORIO', 'ESTUDIANTE', 'USUARIO');

-- CreateEnum
CREATE TYPE "EstadoUsuario" AS ENUM ('ACTIVO', 'INACTIVO', 'SUSPENDIDO');

-- CreateEnum
CREATE TYPE "EstadoCaso" AS ENUM ('ABIERTO', 'EN_PROGRESO', 'CERRADO', 'DERIVADO');

-- CreateEnum
CREATE TYPE "AreaDerecho" AS ENUM ('CIVIL', 'PENAL', 'LABORAL', 'FAMILIA', 'ADMINISTRATIVO', 'CONSTITUCIONAL', 'COMERCIAL', 'OTRO');

-- CreateEnum
CREATE TYPE "EstadoCita" AS ENUM ('PROGRAMADA', 'CONFIRMADA', 'EN_CURSO', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO');

-- CreateEnum
CREATE TYPE "EstadoSesionChat" AS ENUM ('ACTIVA', 'CERRADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "DireccionMensaje" AS ENUM ('ENTRANTE', 'SALIENTE');

-- CreateEnum
CREATE TYPE "RolMensaje" AS ENUM ('USUARIO', 'ASISTENTE', 'SISTEMA');

-- CreateEnum
CREATE TYPE "TipoConsentimiento" AS ENUM ('TRATAMIENTO_DATOS', 'TERMINOS_SERVICIO', 'POLITICA_PRIVACIDAD');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nombre_completo" TEXT NOT NULL,
    "correo" TEXT NOT NULL,
    "telefono" TEXT,
    "password_hash" TEXT,
    "rol" "Rol" NOT NULL DEFAULT 'USUARIO',
    "estado" "EstadoUsuario" NOT NULL DEFAULT 'ACTIVO',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estudiantes" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "codigo" TEXT,
    "programa" TEXT NOT NULL,
    "semestre" INTEGER,
    "activo_consultorio" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estudiantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "casos" (
    "id" TEXT NOT NULL,
    "creado_por_usuario_id" TEXT,
    "telefono_contacto" TEXT,
    "estado" "EstadoCaso" NOT NULL DEFAULT 'ABIERTO',
    "area_derecho" "AreaDerecho",
    "descripcion" TEXT,
    "es_competencia" BOOLEAN,
    "razon_competencia" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "casos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citas" (
    "id" TEXT NOT NULL,
    "caso_id" TEXT NOT NULL,
    "fecha_hora" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoCita" NOT NULL DEFAULT 'PROGRAMADA',
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "citas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones_chat" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "telefono" TEXT NOT NULL,
    "estado" "EstadoSesionChat" NOT NULL DEFAULT 'ACTIVA',
    "caso_id" TEXT,
    "contexto" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "iniciada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerrada_en" TIMESTAMP(3),

    CONSTRAINT "sesiones_chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensajes_chat" (
    "id" TEXT NOT NULL,
    "sesion_id" TEXT NOT NULL,
    "direccion" "DireccionMensaje" NOT NULL,
    "rol" "RolMensaje" NOT NULL,
    "texto" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consulta_rag_id" TEXT,

    CONSTRAINT "mensajes_chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "contenido" TEXT,
    "fuente_url" TEXT,
    "tipo" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fragmentos" (
    "id" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "embedding_json" TEXT,
    "posicion" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fragmentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultas_rag" (
    "id" TEXT NOT NULL,
    "sesion_chat_id" TEXT,
    "texto_consulta" TEXT NOT NULL,
    "embedding_json" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultas_rag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resultados_rag" (
    "id" TEXT NOT NULL,
    "consulta_id" TEXT NOT NULL,
    "fragmento_id" TEXT NOT NULL,
    "score_original" DOUBLE PRECISION NOT NULL,
    "score_reranker" DOUBLE PRECISION,
    "posicion_final" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resultados_rag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluaciones_rag" (
    "id" TEXT NOT NULL,
    "consulta_id" TEXT NOT NULL,
    "relevancia" DOUBLE PRECISION,
    "precision" DOUBLE PRECISION,
    "feedback" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluaciones_rag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentimientos" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "telefono" TEXT,
    "tipo" "TipoConsentimiento" NOT NULL,
    "version_politica" TEXT NOT NULL,
    "aceptado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "consentimientos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correo_key" ON "usuarios"("correo");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_telefono_key" ON "usuarios"("telefono");

-- CreateIndex
CREATE UNIQUE INDEX "estudiantes_usuario_id_key" ON "estudiantes"("usuario_id");

-- CreateIndex
CREATE INDEX "sesiones_chat_telefono_estado_idx" ON "sesiones_chat"("telefono", "estado");

-- CreateIndex
CREATE INDEX "mensajes_chat_sesion_id_creado_en_idx" ON "mensajes_chat"("sesion_id", "creado_en");

-- CreateIndex
CREATE INDEX "fragmentos_documento_id_idx" ON "fragmentos"("documento_id");

-- CreateIndex
CREATE INDEX "consentimientos_telefono_tipo_idx" ON "consentimientos"("telefono", "tipo");

-- AddForeignKey
ALTER TABLE "estudiantes" ADD CONSTRAINT "estudiantes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casos" ADD CONSTRAINT "casos_creado_por_usuario_id_fkey" FOREIGN KEY ("creado_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_caso_id_fkey" FOREIGN KEY ("caso_id") REFERENCES "casos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones_chat" ADD CONSTRAINT "sesiones_chat_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones_chat" ADD CONSTRAINT "sesiones_chat_caso_id_fkey" FOREIGN KEY ("caso_id") REFERENCES "casos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_chat" ADD CONSTRAINT "mensajes_chat_sesion_id_fkey" FOREIGN KEY ("sesion_id") REFERENCES "sesiones_chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_chat" ADD CONSTRAINT "mensajes_chat_consulta_rag_id_fkey" FOREIGN KEY ("consulta_rag_id") REFERENCES "consultas_rag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fragmentos" ADD CONSTRAINT "fragmentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultados_rag" ADD CONSTRAINT "resultados_rag_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "consultas_rag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultados_rag" ADD CONSTRAINT "resultados_rag_fragmento_id_fkey" FOREIGN KEY ("fragmento_id") REFERENCES "fragmentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluaciones_rag" ADD CONSTRAINT "evaluaciones_rag_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "consultas_rag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
