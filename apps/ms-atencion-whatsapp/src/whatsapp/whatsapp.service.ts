import { whatsappRepository } from './whatsapp.repository';
import { WhatsAppWebhookDto } from '@sofia/shared-kernel';
import { DireccionMensaje, RolMensaje } from '@sofia/prisma';
import { serviceRequest } from '@sofia/http-client';
import { env } from '../config';
import { createLogger } from '@sofia/observability';

const log = createLogger('whatsapp-service');

/** Verifica si el teléfono ya aceptó el consentimiento de tratamiento de datos */
async function verificarConsentimiento(telefono: string): Promise<boolean> {
  try {
    const res = await serviceRequest<{ data: Array<{ id: string }> }>(
      env.URL_MS_CONSENTIMIENTOS,
      `/consentimientos/telefono/${encodeURIComponent(telefono)}`,
      { method: 'GET', timeout: 5_000 },
    );
    return Array.isArray(res.data) && res.data.length > 0;
  } catch (err) {
    log.warn({ err, telefono }, 'No se pudo verificar consentimiento, se asume no otorgado');
    return false;
  }
}

/** Registra consentimiento vía ms-consentimientos */
async function registrarConsentimiento(telefono: string): Promise<void> {
  try {
    await serviceRequest(
      env.URL_MS_CONSENTIMIENTOS,
      '/consentimientos',
      {
        method: 'POST',
        body: { telefono, versionPolitica: 'v1.0' },
        timeout: 5_000,
      },
    );
    log.info({ telefono }, 'Consentimiento registrado');
  } catch (err) {
    log.error({ err, telefono }, 'Error al registrar consentimiento');
  }
}

const MENSAJE_CONSENTIMIENTO =
  'Bienvenido al Consultorio Jurídico. Antes de continuar, necesitamos tu autorización ' +
  'para el tratamiento de tus datos personales conforme a la Ley 1581 de 2012.\n\n' +
  'Responde *ACEPTO* para continuar.';

const MENSAJE_CONSENTIMIENTO_OK =
  'Gracias por aceptar. Tu información será tratada de forma confidencial.\n\n' +
  '¿En qué podemos ayudarte hoy?';

export const whatsappService = {
  async procesarMensajeEntrante(dto: WhatsAppWebhookDto) {
    // 1. Encontrar o crear sesión
    const sesion = await whatsappRepository.findOrCreateSesion(dto.telefono);

    // 2. Guardar mensaje entrante
    await whatsappRepository.guardarMensaje({
      sesionId: sesion.id,
      direccion: DireccionMensaje.ENTRANTE,
      rol: RolMensaje.USUARIO,
      texto: dto.mensaje,
    });

    // 3. Verificar consentimiento
    const tieneConsentimiento = await verificarConsentimiento(dto.telefono);

    if (!tieneConsentimiento) {
      // El usuario aún no ha dado consentimiento
      const textoLower = dto.mensaje.trim().toLowerCase();

      if (textoLower === 'acepto' || textoLower === 'sí acepto' || textoLower === 'si acepto') {
        // Registrar consentimiento
        await registrarConsentimiento(dto.telefono);

        await whatsappRepository.guardarMensaje({
          sesionId: sesion.id,
          direccion: DireccionMensaje.SALIENTE,
          rol: RolMensaje.SISTEMA,
          texto: MENSAJE_CONSENTIMIENTO_OK,
        });

        log.info({ telefono: dto.telefono }, 'MOCK: Enviando confirmación de consentimiento');
        return { sesionId: sesion.id, respuesta: MENSAJE_CONSENTIMIENTO_OK, requiereConsentimiento: false };
      }

      // Pedir consentimiento
      await whatsappRepository.guardarMensaje({
        sesionId: sesion.id,
        direccion: DireccionMensaje.SALIENTE,
        rol: RolMensaje.SISTEMA,
        texto: MENSAJE_CONSENTIMIENTO,
      });

      log.info({ telefono: dto.telefono }, 'MOCK: Enviando solicitud de consentimiento');
      return { sesionId: sesion.id, respuesta: MENSAJE_CONSENTIMIENTO, requiereConsentimiento: true };
    }

    // 4. Llamar al MS IA para respuesta
    let textoRespuesta: string;
    try {
      const iaResponse = await serviceRequest<{ data: { textoRespuesta: string } }>(
        env.URL_MS_IA,
        '/ia/respond',
        {
          method: 'POST',
          body: {
            telefono: dto.telefono,
            sesionId: sesion.id,
            textoUsuario: dto.mensaje,
            contexto: sesion.contexto,
          },
        },
      );
      textoRespuesta = iaResponse.data.textoRespuesta;
    } catch (err) {
      log.warn({ err }, 'MS IA no disponible, usando respuesta fallback');
      textoRespuesta =
        'Gracias por contactarnos. En este momento no puedo procesar tu solicitud. ' +
        'Un asesor se comunicará contigo pronto.';
    }

    // 5. Guardar mensaje saliente
    await whatsappRepository.guardarMensaje({
      sesionId: sesion.id,
      direccion: DireccionMensaje.SALIENTE,
      rol: RolMensaje.ASISTENTE,
      texto: textoRespuesta,
    });

    // 6. Enviar al proveedor WhatsApp (mock)
    log.info({ telefono: dto.telefono, respuesta: textoRespuesta }, 'MOCK: Enviando respuesta WhatsApp');

    return { sesionId: sesion.id, respuesta: textoRespuesta, requiereConsentimiento: false };
  },
};
