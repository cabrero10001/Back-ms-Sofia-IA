import { createLogger } from '@sofia/observability';
import { randomUUID } from 'crypto';
import { classifyExtract, type AIResult } from '../clients/aiServiceClient';
import { askRag, type RagAnswerResult } from '../clients/ragClient';
import { conversationClient } from '../clients/conversation.client';
import { env } from '../config';
import { ConversationStore, type ConversationState } from './conversationStore';
import {
  ConversationChannel,
  ConversationMessageType,
  MessageIn,
  MessageOut,
  OrchestratorResponse,
} from '../dtos';

const log = createLogger('orchestrator-service-logic');
const conversationStore = new ConversationStore(env.ORCH_CONV_TTL_MIN * 60_000);

type Intent = 'general' | 'consulta_laboral' | 'consulta_juridica' | 'soporte';
type Step =
  | 'ask_intent'
  | 'ask_city'
  | 'ask_age'
  | 'collecting_issue'
  | 'ready_for_handoff'
  | 'ask_issue'
  | 'offer_appointment'
  | 'ask_user_full_name'
  | 'ask_user_doc_type'
  | 'ask_user_doc_number'
  | 'ask_user_email'
  | 'ask_user_phone_confirm'
  | 'ask_user_phone'
  | 'ask_appointment_mode'
  | 'ask_appointment_day'
  | 'ask_appointment_time'
  | 'confirm_appointment';

interface OrchestratorContext {
  intent?: Intent;
  step?: Step;
  profile?: Record<string, unknown>;
}

interface Decision {
  patch: Record<string, unknown>;
  responseText: string;
  nextIntent: Intent;
  nextStep: Step;
}

const RAG_NEEDS_CONTEXT_FALLBACK =
  'Para ayudarte mejor, necesito un poco más de contexto. Cuéntame el tipo de contrato, tiempo laborado, ciudad/país y qué ocurrió exactamente.';

const RAG_NO_CONTENT_FALLBACK =
  'No puedo responder esa pregunta porque en este momento no hay contenido relacionado en la base documental disponible.';

const APPOINTMENT_OFFER_TEXT =
  '¿Deseas agendar una cita con un asesor profesional? Responde: "si, deseo agendar una cita" o "no, gracias".';

const APPOINTMENT_MODE_TEXT =
  'Perfecto. Elige la modalidad de la cita: presencial o virtual.';

const APPOINTMENT_USER_DATA_START_TEXT =
  'Perfecto, antes de agendar la cita necesito tus datos. Indica tu nombre completo.';

const APPOINTMENT_DOC_TYPE_TEXT =
  'Gracias. Ahora indica tu tipo de documento (CC, CE, TI, PASAPORTE o PPT).';

const DATA_POLICY_TEXT =
  'Antes de comenzar, necesito tu autorización para el tratamiento de datos personales conforme a la política de privacidad. Responde: acepto o no acepto.';

const DATA_POLICY_REJECTED_TEXT =
  'Entiendo. Sin tu autorización no puedo continuar con la atención. Si cambias de opinión, escribe reset. ¡Hasta pronto!';

const FOLLOWUP_HINT_TEXT =
  'Si tienes otra duda escribe reset. Si deseas agendar una cita escribe: si, deseo agendar una cita. Si deseas terminar la conversación, escribe salir.';

const GOODBYE_TEXT =
  '¡Con gusto! Me alegra haberte ayudado. Si quieres volver luego, escribe reset. ¡Hasta pronto!';

const RAG_ERROR_FALLBACK =
  'En este momento no pude consultar la base jurídica. Por favor cuéntame más contexto y lo intento de nuevo.';

const PRELIMINARY_GUIDANCE_DISCLAIMER =
  'Recuerda: esta orientación es preliminar y no reemplaza la atención presencial del Consultorio Jurídico.';

const MENU_TEXT = 'Hola 👋 Te doy la bienvenida a SOF-IA, el asistente virtual del Consultorio Jurídico.\nPuedo orientarte de forma preliminar en consultas laborales y sobre competencias del consultorio, además de ayudarte con soporte y agendamiento de citas.\n\n¿En qué te ayudo hoy?\n1) Laboral\n2) Soporte\n3) Agendar cita';

function mapChannel(channel: MessageIn['channel']): ConversationChannel {
  return channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT';
}

function mapMessageType(type: MessageIn['message']['type']): ConversationMessageType {
  const map: Record<MessageIn['message']['type'], ConversationMessageType> = {
    text: 'TEXT',
    image: 'IMAGE',
    audio: 'AUDIO',
    document: 'DOCUMENT',
    interactive: 'INTERACTIVE',
  };
  return map[type];
}

function normalizeText(text?: string): string {
  return (text ?? '').trim().toLowerCase();
}

function normalizeForMatch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractRawText(input: unknown): string {
  const data = input as {
    text?: unknown;
    message?: unknown;
  };

  const asObj = typeof data?.message === 'object' && data.message !== null
    ? (data.message as { message?: unknown; text?: unknown; body?: unknown })
    : undefined;

  const fromNestedTextObject = typeof asObj?.text === 'object' && asObj.text !== null
    ? pickString((asObj.text as { body?: unknown }).body)
    : undefined;

  const extracted = pickString(data?.text)
    ?? (typeof data?.message === 'string' ? pickString(data.message) : undefined)
    ?? pickString(asObj?.message)
    ?? pickString(asObj?.text)
    ?? pickString(asObj?.body)
    ?? fromNestedTextObject
    ?? '';

  return extracted;
}

function extractText(input: unknown): string {
  return normalizeText(extractRawText(input));
}

function parseAge(text: string): number | undefined {
  const match = text.match(/\d{1,3}/);
  if (!match) return undefined;

  const age = Number.parseInt(match[0], 10);
  if (!Number.isFinite(age) || age <= 0 || age > 120) return undefined;
  return age;
}

function parseContext(raw: Record<string, unknown>): OrchestratorContext {
  return {
    intent: typeof raw.intent === 'string' ? (raw.intent as Intent) : undefined,
    step: typeof raw.step === 'string' ? (raw.step as Step) : undefined,
    profile: typeof raw.profile === 'object' && raw.profile !== null
      ? (raw.profile as Record<string, unknown>)
      : undefined,
  };
}

function normalizeIntent(intent: string | undefined): Intent {
  if (intent === 'consulta_juridica') return 'consulta_laboral';
  if (intent === 'consulta_laboral' || intent === 'soporte' || intent === 'general') return intent;
  return 'general';
}

function buildConversationKey(input: MessageIn): string {
  return `${input.tenantId}:${input.channel}:${input.externalUserId}`;
}

function isResetCommand(text: string): boolean {
  return ['reset', 'reiniciar', 'menu', 'menú', 'inicio', 'empezar'].includes(text);
}

function isConversationEndCommand(text: string): boolean {
  return [
    'salir',
    'terminar',
    'finalizar',
    'fin',
    'adios',
    'adiós',
    'chao',
    'hasta luego',
    'hasta pronto',
    'bye',
  ].includes(text);
}

function isNoMoreDoubtsMessage(text: string): boolean {
  return [
    'gracias',
    'muchas gracias',
    'listo gracias',
    'listo muchas gracias',
    'eso es todo',
    'todo claro',
    'no tengo mas dudas',
    'no tengo más dudas',
    'ninguna duda',
  ].includes(text);
}

function isAnotherQuestionPrompt(text: string): boolean {
  return text.includes('otra duda') || text.includes('otra consulta');
}

function isPolicyAccepted(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return [
    'acepto',
    'si acepto',
    'sí acepto',
    'autorizo',
    'si autorizo',
    'sí autorizo',
    'de acuerdo',
  ].includes(normalized);
}

function isPolicyRejected(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return [
    'no acepto',
    'no autorizo',
    'rechazo',
    'no',
  ].includes(normalized);
}

function isPositiveReply(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return [
    'si',
    's',
    'claro',
    'de acuerdo',
    'ok',
    'okay',
    'dale',
    'de una',
  ].includes(normalized);
}

function isNegativeReply(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return [
    'no',
    'no gracias',
    'por ahora no',
    'ahora no',
  ].includes(normalized);
}

function isScheduleAppointmentRequest(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('agendar') && normalized.includes('cita');
}

function pickAppointmentMode(text: string): 'virtual' | 'presencial' | undefined {
  const normalized = normalizeForMatch(text);
  if (normalized.includes('virtual')) return 'virtual';
  if (normalized.includes('presencial')) return 'presencial';
  return undefined;
}

function pickWeekday(text: string): 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes' | undefined {
  const normalized = normalizeForMatch(text);
  if (normalized.includes('lunes')) return 'lunes';
  if (normalized.includes('martes')) return 'martes';
  if (normalized.includes('miercoles')) return 'miercoles';
  if (normalized.includes('jueves')) return 'jueves';
  if (normalized.includes('viernes')) return 'viernes';
  return undefined;
}

function hasWeekendMention(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('sabado') || normalized.includes('domingo');
}

function pickHour24(text: string): number | undefined {
  const normalized = normalizeForMatch(text);
  const match = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return undefined;

  const rawHour = Number.parseInt(match[1], 10);
  if (!Number.isFinite(rawHour)) return undefined;

  const suffix = match[3];
  const hasMorning = normalized.includes('manana');
  const hasAfternoon = normalized.includes('tarde');

  let hour = rawHour;
  if (suffix === 'am') {
    if (hour === 12) hour = 0;
  } else if (suffix === 'pm') {
    if (hour < 12) hour += 12;
  } else if (hasMorning) {
    if (hour === 12) hour = 0;
  } else if (hasAfternoon) {
    if (hour < 12) hour += 12;
  }

  if (hour < 0 || hour > 23) return undefined;
  return hour;
}

function isHourAllowedByMode(mode: 'virtual' | 'presencial', hour24: number): boolean {
  if (mode === 'virtual') return hour24 >= 8 && hour24 <= 17;
  return hour24 >= 13 && hour24 <= 17;
}

function formatHour(hour24: number): string {
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const raw = hour24 % 12;
  const hour12 = raw === 0 ? 12 : raw;
  return `${hour12}:00 ${suffix}`;
}

function appointmentHourHint(mode: 'virtual' | 'presencial'): string {
  if (mode === 'virtual') {
    return 'Horario virtual disponible: lunes a viernes de 8:00 AM a 5:00 PM.';
  }
  return 'Horario presencial disponible: lunes a viernes de 1:00 PM a 5:00 PM.';
}

function formatWeekday(day: 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes'): string {
  if (day === 'miercoles') return 'miércoles';
  return day;
}

function isAppointmentConfirmCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized === 'confirmar cita'
    || normalized === 'confirmar'
    || normalized === 'confirmo'
    || normalized === 'sin cambios'
    || normalized === 'no cambios'
    || normalized === 'esta bien'
    || normalized === 'está bien';
}

function isAppointmentChangeModeCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar modalidad') || normalized === 'modalidad';
}

function isAppointmentChangeDayCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar dia') || normalized === 'dia';
}

function isAppointmentChangeHourCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar hora') || normalized === 'hora';
}

function isAppointmentChangeFullNameCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar nombre') || normalized === 'nombre';
}

function isAppointmentChangeDocTypeCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar tipo de documento')
    || normalized.includes('cambiar tipo documento')
    || normalized === 'tipo de documento'
    || normalized === 'tipo documento';
}

function isAppointmentChangeDocNumberCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar numero de documento')
    || normalized.includes('cambiar número de documento')
    || normalized.includes('cambiar documento')
    || normalized === 'numero de documento'
    || normalized === 'número de documento'
    || normalized === 'documento';
}

function isAppointmentChangeEmailCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar correo') || normalized.includes('cambiar email') || normalized === 'correo' || normalized === 'email';
}

function isAppointmentChangePhoneCommand(text: string): boolean {
  const normalized = normalizeForMatch(text);
  return normalized.includes('cambiar numero')
    || normalized.includes('cambiar número')
    || normalized.includes('cambiar telefono')
    || normalized.includes('cambiar teléfono')
    || normalized === 'numero'
    || normalized === 'número'
    || normalized === 'telefono'
    || normalized === 'teléfono';
}

type DocumentType = 'CC' | 'CE' | 'TI' | 'PASAPORTE' | 'PPT';

function pickDocumentType(text: string): DocumentType | undefined {
  const normalized = normalizeForMatch(text);
  if (normalized === 'cc' || normalized.includes('cedula de ciudadania') || normalized.includes('cedula ciudadania')) {
    return 'CC';
  }
  if (normalized === 'ce' || normalized.includes('cedula de extranjeria') || normalized.includes('cedula extranjeria')) {
    return 'CE';
  }
  if (normalized === 'ti' || normalized.includes('tarjeta de identidad')) {
    return 'TI';
  }
  if (normalized.includes('pasaporte')) {
    return 'PASAPORTE';
  }
  if (normalized === 'ppt' || normalized.includes('permiso por proteccion temporal') || normalized.includes('permiso por proteccion')) {
    return 'PPT';
  }
  return undefined;
}

function pickDocumentNumber(text: string): string | undefined {
  const compact = text.trim().replace(/\s+/g, '');
  if (!/^[a-zA-Z0-9.-]{5,20}$/.test(compact)) return undefined;
  return compact;
}

function pickEmail(text: string): string | undefined {
  const value = text.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return undefined;
  return value;
}

function pickPhone(text: string): string | undefined {
  const digits = text.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return undefined;
  return digits;
}

function pickPhoneFromExternalUserId(externalUserId: string): string | undefined {
  const digits = externalUserId.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return undefined;
  return digits;
}

function pickFullName(text: string): string | undefined {
  const value = text.trim().replace(/\s{2,}/g, ' ');
  if (value.length < 6) return undefined;
  const words = value.split(' ');
  if (words.length < 2) return undefined;
  return value;
}

type AppointmentUserData = {
  fullName: string;
  documentType: DocumentType;
  documentNumber: string;
  email: string;
  phone: string;
};

type AppointmentScheduleData = {
  mode: 'virtual' | 'presencial';
  day: 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes';
  hour24: number;
};

type LaboralCompetenceAssessment = {
  status: 'competent' | 'not_competent' | 'unknown';
  reason?: string;
};

function pickAppointmentUserData(profile: Record<string, unknown>): AppointmentUserData | undefined {
  const userData = typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null
    ? (profile.appointmentUser as Record<string, unknown>)
    : undefined;
  if (!userData) return undefined;

  const fullName = typeof userData.fullName === 'string' ? userData.fullName : undefined;
  const documentType = typeof userData.documentType === 'string' ? userData.documentType as DocumentType : undefined;
  const documentNumber = typeof userData.documentNumber === 'string' ? userData.documentNumber : undefined;
  const email = typeof userData.email === 'string' ? userData.email : undefined;
  const phone = typeof userData.phone === 'string' ? userData.phone : undefined;

  if (!fullName || !documentType || !documentNumber || !email || !phone) return undefined;
  return { fullName, documentType, documentNumber, email, phone };
}

function pickAppointmentScheduleData(profile: Record<string, unknown>): AppointmentScheduleData | undefined {
  const appointment = (typeof profile.appointment === 'object' && profile.appointment !== null)
    ? (profile.appointment as Record<string, unknown>)
    : undefined;
  if (!appointment) return undefined;

  const mode = appointment.mode === 'virtual' || appointment.mode === 'presencial'
    ? appointment.mode
    : undefined;
  const day = pickWeekday(String(appointment.day ?? ''));
  const hour24 = typeof appointment.hour24 === 'number' ? appointment.hour24 : undefined;

  if (!mode || !day || hour24 === undefined || !isHourAllowedByMode(mode, hour24)) return undefined;
  return { mode, day, hour24 };
}

function shouldReturnToConfirm(profile: Record<string, unknown>): boolean {
  return profile.appointmentReturnToConfirm === true;
}

function clearReturnToConfirmFlag(profile: Record<string, unknown>): Record<string, unknown> {
  return {
    ...profile,
    appointmentReturnToConfirm: undefined,
  };
}

function buildAppointmentConfirmationText(userData: AppointmentUserData, schedule: AppointmentScheduleData): string {
  return `Confírmame estos datos de tu cita:\n- Nombre completo: ${userData.fullName}\n- Tipo de documento: ${userData.documentType}\n- Número de documento: ${userData.documentNumber}\n- Correo: ${userData.email}\n- Número: ${userData.phone}\n- Modalidad: ${schedule.mode}\n- Día: ${formatWeekday(schedule.day)}\n- Hora: ${formatHour(schedule.hour24)}\n\nSi deseas cambiar un dato escribe: cambiar nombre, cambiar tipo de documento, cambiar numero de documento, cambiar correo, cambiar numero, cambiar modalidad, cambiar dia o cambiar hora.\nSi todo está correcto escribe: confirmar cita.`;
}

function evaluateLaboralCompetence(text: string): LaboralCompetenceAssessment {
  const normalized = normalizeForMatch(text);

  const laboralKeywords = [
    'despido',
    'liquidacion',
    'salario',
    'prestaciones',
    'cesantias',
    'vacaciones',
    'indemnizacion',
    'seguridad social',
    'incapacidad',
    'contrato laboral',
    'empleador',
    'trabajo',
  ];

  const nonLaboralKeywords = [
    'homicidio',
    'hurto',
    'divorcio',
    'custodia',
    'alimentos',
    'sucesion',
    'herencia',
    'compraventa',
    'arrendamiento',
    'transito',
    'comparendo',
  ];

  const hasLaboralSignal = laboralKeywords.some((keyword) => normalized.includes(keyword));
  const hasNonLaboralSignal = nonLaboralKeywords.some((keyword) => normalized.includes(keyword));

  const amountMatch = normalized.match(/(\d{1,4})\s*(smlmv|salarios? minimos?)/);
  if (amountMatch) {
    const amount = Number.parseInt(amountMatch[1], 10);
    if (Number.isFinite(amount) && amount > 20) {
      return {
        status: 'not_competent',
        reason: 'La cuantía reportada supera el límite de 20 SMLMV para asuntos laborales del consultorio jurídico.',
      };
    }
  }

  if (hasNonLaboralSignal && !hasLaboralSignal) {
    return {
      status: 'not_competent',
      reason: 'El asunto reportado parece corresponder a un área diferente a laboral.',
    };
  }

  if (hasLaboralSignal) {
    return { status: 'competent' };
  }

  return { status: 'unknown' };
}

function isLaboralSelection(text: string): boolean {
  return text === '1' || text.includes('laboral') || text.includes('jurid') || text.includes('trabajo');
}

function isSoporteSelection(text: string): boolean {
  return text === '2' || text.includes('soporte') || text.includes('problema') || text.includes('error');
}

function isAppointmentSelection(text: string): boolean {
  return text === '3' || text.includes('agendar cita') || text.includes('agendamiento') || text.includes('cita');
}

function defaultState(): Omit<ConversationState, 'updatedAt' | 'expiresAt'> {
  return {
    stage: 'awaiting_policy_consent',
    category: undefined,
    profile: {},
  };
}

type StatefulFlowResult = {
  responseText: string;
  patch: Record<string, unknown>;
  payload: Record<string, unknown>;
};

type RagFallbackKind = 'none' | 'needs_context' | 'no_content';

async function resolveLaboralQuery(input: {
  queryText: string;
  correlationId: string;
  tenantId: string;
  conversationId: string;
}): Promise<{ responseText: string; payload: Record<string, unknown>; noSupport: boolean; queryUsed: string }> {
  const query = input.queryText.trim();
  if (!query) {
    return {
      responseText: 'Escribe tu consulta laboral para ayudarte mejor.',
      payload: { rag: { status: 'empty_query' }, correlationId: input.correlationId },
      noSupport: true,
      queryUsed: query,
    };
  }

  const ragStartedAt = Date.now();
  try {
    const ragResult = await askRag(query, input.correlationId);
    const fallbackKind = pickRagFallbackKind(ragResult);
    const isNoSupport = fallbackKind !== 'none';
    const responseText = fallbackKind === 'none'
      ? buildRagWhatsappText(ragResult, 'Laboral')
      : fallbackKind === 'no_content'
        ? appendPreliminaryDisclaimer(RAG_NO_CONTENT_FALLBACK)
        : appendPreliminaryDisclaimer(RAG_NEEDS_CONTEXT_FALLBACK);

    log.info(
      {
        correlationId: input.correlationId,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        intent: 'consulta_laboral',
        queryLen: query.length,
        querySample: query.slice(0, 40),
        ragLatencyMs: Date.now() - ragStartedAt,
        ragStatusCode: ragResult.statusCode,
      },
      'RAG response integrated (stateful flow)',
    );

    return {
      responseText,
      payload: {
        correlationId: input.correlationId,
        rag: {
          statusCode: ragResult.statusCode,
          latencyMs: ragResult.latencyMs,
          citationsCount: ragResult.citations.length,
          usedChunksCount: ragResult.usedChunks.length,
          noSupport: isNoSupport,
          noSupportKind: fallbackKind,
        },
      },
      noSupport: isNoSupport,
      queryUsed: query,
    };
  } catch (error) {
    log.warn(
      {
        correlationId: input.correlationId,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        intent: 'consulta_laboral',
        queryLen: query.length,
        querySample: query.slice(0, 40),
        error: error instanceof Error ? error.message : String(error),
      },
      'RAG call failed in stateful flow',
    );

    return {
      responseText: appendPreliminaryDisclaimer(RAG_ERROR_FALLBACK),
      payload: {
        correlationId: input.correlationId,
        rag: {
          status: 'error',
          latencyMs: Date.now() - ragStartedAt,
          error: error instanceof Error ? error.message : String(error),
        },
      },
      noSupport: true,
      queryUsed: query,
    };
  }
}

async function runStatefulFlow(input: {
  messageIn: MessageIn;
  text: string;
  rawText: string;
  conversationId: string;
  correlationId: string;
}): Promise<StatefulFlowResult> {
  const key = buildConversationKey(input.messageIn);

  if (isResetCommand(input.text)) {
    conversationStore.clear(key);
    conversationStore.set(key, defaultState());
    return {
      responseText: DATA_POLICY_TEXT,
      patch: { intent: 'general', step: 'ask_intent', profile: { policyAccepted: false } },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', reset: true },
    };
  }

  if (isConversationEndCommand(input.text)) {
    conversationStore.clear(key);
    conversationStore.set(key, defaultState());
    return {
      responseText: GOODBYE_TEXT,
      patch: { intent: 'general', step: 'ask_intent', profile: {} },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', ended: true },
    };
  }

  const state = conversationStore.get(key) ?? conversationStore.set(key, defaultState());

  if (state.stage === 'awaiting_policy_consent') {
    if (isPolicyAccepted(input.text)) {
      const nextProfile = {
        ...(state.profile ?? {}),
        policyAccepted: true,
      };
      conversationStore.set(key, {
        stage: 'awaiting_category',
        category: undefined,
        profile: nextProfile,
      });
      return {
        responseText: MENU_TEXT,
        patch: { intent: 'general', step: 'ask_intent', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', policyAccepted: true },
      };
    }

    if (isPolicyRejected(input.text)) {
      conversationStore.clear(key);
      conversationStore.set(key, defaultState());
      return {
        responseText: DATA_POLICY_REJECTED_TEXT,
        patch: { intent: 'general', step: 'ask_intent', profile: { policyAccepted: false } },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', policyAccepted: false, ended: true },
      };
    }

    return {
      responseText: DATA_POLICY_TEXT,
      patch: { intent: 'general', step: 'ask_intent', profile: { ...(state.profile ?? {}), policyAccepted: false } },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', awaitingPolicyConsent: true },
    };
  }
  const profile = (state.profile ?? {}) as Record<string, unknown>;
  const appointment = (typeof profile.appointment === 'object' && profile.appointment !== null)
    ? (profile.appointment as Record<string, unknown>)
    : {};
  const appointmentUser = (typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null)
    ? (profile.appointmentUser as Record<string, unknown>)
    : {};

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_opt') {
    if (isScheduleAppointmentRequest(input.text) || isPositiveReply(input.text)) {
      conversationStore.set(key, {
        stage: 'awaiting_user_full_name',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_USER_DATA_START_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_full_name' },
      };
    }

    if (isNegativeReply(input.text)) {
      conversationStore.set(key, {
        stage: 'awaiting_question',
        category: 'laboral',
        profile: {
          ...profile,
          appointment: undefined,
        },
      });
      return {
        responseText: `Perfecto, continuamos sin agendar cita. ${FOLLOWUP_HINT_TEXT}`,
        patch: {
          intent: 'consulta_laboral',
          step: 'ask_issue',
          profile: {
            ...profile,
            appointment: undefined,
          },
        },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'declined' },
      };
    }

    return {
      responseText: 'Por favor responde: "si, deseo agendar una cita" o "no, gracias".',
      patch: { intent: 'consulta_laboral', step: 'offer_appointment', profile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'offer' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_user_full_name') {
    const fullName = pickFullName(input.rawText);
    if (!fullName) {
      return {
        responseText: 'Por favor indícame tu nombre completo (nombre y apellido).',
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_full_name_invalid' },
      };
    }

    const nextProfile = {
      ...profile,
      appointmentUser: {
        ...(typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null ? profile.appointmentUser as Record<string, unknown> : {}),
        fullName,
      },
    };

    if (shouldReturnToConfirm(profile)) {
      const userData = pickAppointmentUserData(nextProfile);
      const schedule = pickAppointmentScheduleData(nextProfile);
      if (userData && schedule) {
        const finalProfile = clearReturnToConfirmFlag(nextProfile);
        conversationStore.set(key, {
          stage: 'awaiting_appointment_confirm',
          category: 'laboral',
          profile: finalProfile,
        });
        return {
          responseText: buildAppointmentConfirmationText(userData, schedule),
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: finalProfile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm_after_change' },
        };
      }
    }

    conversationStore.set(key, {
      stage: 'awaiting_user_doc_type',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: APPOINTMENT_DOC_TYPE_TEXT,
      patch: { intent: 'consulta_laboral', step: 'ask_user_doc_type', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_doc_type' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_user_doc_type') {
    const documentType = pickDocumentType(input.text);
    if (!documentType) {
      return {
        responseText: 'No entendí el tipo de documento. Responde con una opción: CC, CE, TI, PASAPORTE o PPT.',
        patch: { intent: 'consulta_laboral', step: 'ask_user_doc_type', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_doc_type_invalid' },
      };
    }

    const nextProfile = {
      ...profile,
      appointmentUser: {
        ...(typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null ? profile.appointmentUser as Record<string, unknown> : {}),
        documentType,
      },
    };

    if (shouldReturnToConfirm(profile)) {
      const userData = pickAppointmentUserData(nextProfile);
      const schedule = pickAppointmentScheduleData(nextProfile);
      if (userData && schedule) {
        const finalProfile = clearReturnToConfirmFlag(nextProfile);
        conversationStore.set(key, {
          stage: 'awaiting_appointment_confirm',
          category: 'laboral',
          profile: finalProfile,
        });
        return {
          responseText: buildAppointmentConfirmationText(userData, schedule),
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: finalProfile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm_after_change' },
        };
      }
    }

    conversationStore.set(key, {
      stage: 'awaiting_user_doc_number',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: 'Perfecto. Ahora escribe tu número de documento.',
      patch: { intent: 'consulta_laboral', step: 'ask_user_doc_number', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_doc_number' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_user_doc_number') {
    const documentNumber = pickDocumentNumber(input.rawText);
    if (!documentNumber) {
      return {
        responseText: 'El número de documento no es válido. Inténtalo de nuevo (solo letras, números, punto o guion).',
        patch: { intent: 'consulta_laboral', step: 'ask_user_doc_number', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_doc_number_invalid' },
      };
    }

    const nextProfile = {
      ...profile,
      appointmentUser: {
        ...(typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null ? profile.appointmentUser as Record<string, unknown> : {}),
        documentNumber,
      },
    };

    if (shouldReturnToConfirm(profile)) {
      const userData = pickAppointmentUserData(nextProfile);
      const schedule = pickAppointmentScheduleData(nextProfile);
      if (userData && schedule) {
        const finalProfile = clearReturnToConfirmFlag(nextProfile);
        conversationStore.set(key, {
          stage: 'awaiting_appointment_confirm',
          category: 'laboral',
          profile: finalProfile,
        });
        return {
          responseText: buildAppointmentConfirmationText(userData, schedule),
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: finalProfile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm_after_change' },
        };
      }
    }

    conversationStore.set(key, {
      stage: 'awaiting_user_email',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: 'Gracias. Ahora escribe tu correo electrónico.',
      patch: { intent: 'consulta_laboral', step: 'ask_user_email', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_email' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_user_email') {
    const email = pickEmail(input.rawText);
    if (!email) {
      return {
        responseText: 'El correo no es válido. Escríbelo de nuevo (ejemplo: nombre@dominio.com).',
        patch: { intent: 'consulta_laboral', step: 'ask_user_email', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_email_invalid' },
      };
    }

    const nextProfile = {
      ...profile,
      appointmentUser: {
        ...(typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null ? profile.appointmentUser as Record<string, unknown> : {}),
        email,
      },
    };

    if (shouldReturnToConfirm(profile)) {
      const userData = pickAppointmentUserData(nextProfile);
      const schedule = pickAppointmentScheduleData(nextProfile);
      if (userData && schedule) {
        const finalProfile = clearReturnToConfirmFlag(nextProfile);
        conversationStore.set(key, {
          stage: 'awaiting_appointment_confirm',
          category: 'laboral',
          profile: finalProfile,
        });
        return {
          responseText: buildAppointmentConfirmationText(userData, schedule),
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: finalProfile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm_after_change' },
        };
      }
    }

    const inferredPhone = pickPhoneFromExternalUserId(input.messageIn.externalUserId);
    if (inferredPhone) {
      const profileWithPhone = {
        ...nextProfile,
        appointmentUser: {
          ...(nextProfile.appointmentUser as Record<string, unknown>),
          phone: inferredPhone,
        },
      };

      conversationStore.set(key, {
        stage: 'awaiting_user_phone_confirm',
        category: 'laboral',
        profile: profileWithPhone,
      });

      return {
        responseText: `Perfecto. ¿Deseas usar este número de contacto: ${inferredPhone}? Responde si o no. Si quieres cambiarlo, escribe el nuevo número.`,
        patch: { intent: 'consulta_laboral', step: 'ask_user_phone_confirm', profile: profileWithPhone },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_phone_confirm' },
      };
    }

    conversationStore.set(key, {
      stage: 'awaiting_user_phone',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: 'Por último, indícame tu número de contacto.',
      patch: { intent: 'consulta_laboral', step: 'ask_user_phone', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_phone' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_user_phone_confirm') {
    const currentPhone = typeof appointmentUser.phone === 'string'
      ? String(appointmentUser.phone)
      : undefined;
    const providedPhone = pickPhone(input.rawText);

    if (providedPhone) {
      const nextProfile = {
        ...profile,
        appointmentUser: {
          ...(typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null ? profile.appointmentUser as Record<string, unknown> : {}),
          phone: providedPhone,
        },
      };
      conversationStore.set(key, {
        stage: 'awaiting_appointment_mode',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: `Perfecto. Guardé el número ${providedPhone}. ${APPOINTMENT_MODE_TEXT}`,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_phone_changed' },
      };
    }

    if (isPositiveReply(input.text)) {
      if (!currentPhone) {
        conversationStore.set(key, {
          stage: 'awaiting_user_phone',
          category: 'laboral',
          profile,
        });
        return {
          responseText: 'No pude leer tu número automáticamente. Por favor indícame tu número de contacto.',
          patch: { intent: 'consulta_laboral', step: 'ask_user_phone', profile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_phone_missing' },
        };
      }

      conversationStore.set(key, {
        stage: 'awaiting_appointment_mode',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_MODE_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'mode' },
      };
    }

    if (isNegativeReply(input.text) || isAppointmentChangePhoneCommand(input.text)) {
      conversationStore.set(key, {
        stage: 'awaiting_user_phone',
        category: 'laboral',
        profile,
      });
      return {
        responseText: 'Entendido. Indícame el número de contacto que deseas usar.',
        patch: { intent: 'consulta_laboral', step: 'ask_user_phone', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'collect_user_phone_manual' },
      };
    }

    return {
      responseText: 'Responde si o no para confirmar el número, o escribe directamente el nuevo número de contacto.',
      patch: { intent: 'consulta_laboral', step: 'ask_user_phone_confirm', profile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_phone_confirm_waiting' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_user_phone') {
    const phone = pickPhone(input.rawText);
    if (!phone) {
      return {
        responseText: 'El número no es válido. Escríbelo nuevamente solo con números o con prefijo de país.',
        patch: { intent: 'consulta_laboral', step: 'ask_user_phone', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_phone_invalid' },
      };
    }

    const nextProfile = {
      ...profile,
      appointmentUser: {
        ...(typeof profile.appointmentUser === 'object' && profile.appointmentUser !== null ? profile.appointmentUser as Record<string, unknown> : {}),
        phone,
      },
    };

    if (shouldReturnToConfirm(profile)) {
      const userData = pickAppointmentUserData(nextProfile);
      const schedule = pickAppointmentScheduleData(nextProfile);
      if (userData && schedule) {
        const finalProfile = clearReturnToConfirmFlag(nextProfile);
        conversationStore.set(key, {
          stage: 'awaiting_appointment_confirm',
          category: 'laboral',
          profile: finalProfile,
        });
        return {
          responseText: buildAppointmentConfirmationText(userData, schedule),
          patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: finalProfile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm_after_change' },
        };
      }
    }

    conversationStore.set(key, {
      stage: 'awaiting_appointment_mode',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: APPOINTMENT_MODE_TEXT,
      patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'mode' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_mode') {
    const userData = pickAppointmentUserData(profile);
    if (!userData) {
      conversationStore.set(key, {
        stage: 'awaiting_user_full_name',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_USER_DATA_START_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_data_missing' },
      };
    }

    const mode = pickAppointmentMode(input.text);
    if (!mode) {
      return {
        responseText: 'No te entendí la modalidad. Escribe: presencial o virtual.',
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'mode_invalid' },
      };
    }

    const nextProfile = {
      ...profile,
      appointment: {
        ...appointment,
        mode,
      },
    };

    conversationStore.set(key, {
      stage: 'awaiting_appointment_day',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: `Perfecto, modalidad ${mode}. Ahora indica el día (lunes a viernes).`,
      patch: { intent: 'consulta_laboral', step: 'ask_appointment_day', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'day' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_day') {
    const day = pickWeekday(input.text);
    if (!day) {
      const weekendMsg = hasWeekendMention(input.text)
        ? 'Solo tenemos agenda de lunes a viernes.'
        : 'No entendí el día.';
      return {
        responseText: `${weekendMsg} Por favor indica un día entre lunes y viernes.`,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_day', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'day_invalid' },
      };
    }

    const mode = appointment.mode === 'virtual' || appointment.mode === 'presencial'
      ? appointment.mode
      : undefined;

    if (!mode) {
      conversationStore.set(key, {
        stage: 'awaiting_appointment_mode',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_MODE_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'mode_missing' },
      };
    }

    const nextProfile = {
      ...profile,
      appointment: {
        ...appointment,
        mode,
        day,
      },
    };

    conversationStore.set(key, {
      stage: 'awaiting_appointment_time',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: `${appointmentHourHint(mode)} Indica la hora de tu cita.`,
      patch: { intent: 'consulta_laboral', step: 'ask_appointment_time', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'time' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_time') {
    const userData = pickAppointmentUserData(profile);
    if (!userData) {
      conversationStore.set(key, {
        stage: 'awaiting_user_full_name',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_USER_DATA_START_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'user_data_missing' },
      };
    }

    const mode = appointment.mode === 'virtual' || appointment.mode === 'presencial'
      ? appointment.mode
      : undefined;
    const day = pickWeekday(String(appointment.day ?? ''));

    if (!mode) {
      conversationStore.set(key, {
        stage: 'awaiting_appointment_mode',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_MODE_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'mode_missing' },
      };
    }

    if (!day) {
      conversationStore.set(key, {
        stage: 'awaiting_appointment_day',
        category: 'laboral',
        profile,
      });
      return {
        responseText: 'Primero necesito el día de la cita. Indica un día entre lunes y viernes.',
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_day', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'day_missing' },
      };
    }

    const hour24 = pickHour24(input.text);
    if (hour24 === undefined) {
      return {
        responseText: `${appointmentHourHint(mode)} Escribe la hora en formato como 8am, 3pm o 15:00.`,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_time', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'time_invalid' },
      };
    }

    if (!isHourAllowedByMode(mode, hour24)) {
      return {
        responseText: `La hora no está disponible para modalidad ${mode}. ${appointmentHourHint(mode)}`,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_time', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'time_out_of_range' },
      };
    }

    const nextProfile = {
      ...profile,
      appointment: {
        ...appointment,
        mode,
        day,
        hour24,
      },
    };

    conversationStore.set(key, {
      stage: 'awaiting_appointment_confirm',
      category: 'laboral',
      profile: nextProfile,
    });

    return {
      responseText: `Confírmame estos datos de tu cita:\n- Nombre completo: ${userData.fullName}\n- Tipo de documento: ${userData.documentType}\n- Número de documento: ${userData.documentNumber}\n- Correo: ${userData.email}\n- Número: ${userData.phone}\n- Modalidad: ${mode}\n- Día: ${formatWeekday(day)}\n- Hora: ${formatHour(hour24)}\n\nSi deseas cambiar un dato escribe: cambiar nombre, cambiar tipo de documento, cambiar numero de documento, cambiar correo, cambiar numero, cambiar modalidad, cambiar dia o cambiar hora.\nSi todo está correcto escribe: confirmar cita.`,
      patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile: nextProfile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_appointment_confirm') {
    if (isAppointmentChangeFullNameCommand(input.text)) {
      const nextProfile = {
        ...profile,
        appointmentReturnToConfirm: true,
      };
      conversationStore.set(key, {
        stage: 'awaiting_user_full_name',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: 'Perfecto, indícame el nombre completo actualizado.',
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_user_full_name' },
      };
    }

    if (isAppointmentChangeDocTypeCommand(input.text)) {
      const nextProfile = {
        ...profile,
        appointmentReturnToConfirm: true,
      };
      conversationStore.set(key, {
        stage: 'awaiting_user_doc_type',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: APPOINTMENT_DOC_TYPE_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_user_doc_type', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_user_doc_type' },
      };
    }

    if (isAppointmentChangeDocNumberCommand(input.text)) {
      const nextProfile = {
        ...profile,
        appointmentReturnToConfirm: true,
      };
      conversationStore.set(key, {
        stage: 'awaiting_user_doc_number',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: 'Perfecto, escribe el nuevo número de documento.',
        patch: { intent: 'consulta_laboral', step: 'ask_user_doc_number', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_user_doc_number' },
      };
    }

    if (isAppointmentChangeEmailCommand(input.text)) {
      const nextProfile = {
        ...profile,
        appointmentReturnToConfirm: true,
      };
      conversationStore.set(key, {
        stage: 'awaiting_user_email',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: 'Perfecto, escribe el correo actualizado.',
        patch: { intent: 'consulta_laboral', step: 'ask_user_email', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_user_email' },
      };
    }

    if (isAppointmentChangePhoneCommand(input.text)) {
      const nextProfile = {
        ...profile,
        appointmentReturnToConfirm: true,
      };
      conversationStore.set(key, {
        stage: 'awaiting_user_phone',
        category: 'laboral',
        profile: nextProfile,
      });
      return {
        responseText: 'Perfecto, indícame el número de contacto actualizado.',
        patch: { intent: 'consulta_laboral', step: 'ask_user_phone', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_user_phone' },
      };
    }

    if (isAppointmentChangeModeCommand(input.text)) {
      conversationStore.set(key, {
        stage: 'awaiting_appointment_mode',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_MODE_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_mode', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_mode' },
      };
    }

    if (isAppointmentChangeDayCommand(input.text)) {
      conversationStore.set(key, {
        stage: 'awaiting_appointment_day',
        category: 'laboral',
        profile,
      });
      return {
        responseText: 'Perfecto, indícame el nuevo día (lunes a viernes).',
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_day', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_day' },
      };
    }

    if (isAppointmentChangeHourCommand(input.text)) {
      const mode = appointment.mode === 'virtual' || appointment.mode === 'presencial'
        ? appointment.mode
        : 'virtual';
      conversationStore.set(key, {
        stage: 'awaiting_appointment_time',
        category: 'laboral',
        profile,
      });
      return {
        responseText: `Perfecto, indícame la nueva hora. ${appointmentHourHint(mode)}`,
        patch: { intent: 'consulta_laboral', step: 'ask_appointment_time', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'change_time' },
      };
    }

    if (isAppointmentConfirmCommand(input.text)) {
      const userData = pickAppointmentUserData(profile);
      const mode = appointment.mode === 'virtual' || appointment.mode === 'presencial'
        ? appointment.mode
        : undefined;
      const day = pickWeekday(String(appointment.day ?? ''));
      const hour24 = typeof appointment.hour24 === 'number' ? appointment.hour24 : undefined;

      if (!userData || !mode || !day || hour24 === undefined || !isHourAllowedByMode(mode, hour24)) {
        conversationStore.set(key, {
          stage: 'awaiting_user_full_name',
          category: 'laboral',
          profile,
        });
        return {
          responseText: 'Falta completar algunos datos de contacto. Vamos de nuevo. Indica tu nombre completo.',
          patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile },
          payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'recollect' },
        };
      }

      const nextProfile = {
        ...profile,
        lastAppointment: {
          user: userData,
          mode,
          day,
          hour24,
        },
      };

      conversationStore.set(key, {
        stage: 'awaiting_question',
        category: 'laboral',
        profile: nextProfile,
      });

      return {
        responseText: `Listo, tu cita quedó agendada para ${formatWeekday(day)} a las ${formatHour(hour24)} en modalidad ${mode}. ${FOLLOWUP_HINT_TEXT}`,
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile: nextProfile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'scheduled' },
      };
    }

    return {
      responseText: 'Si deseas continuar, escribe: confirmar cita. Si quieres cambiar datos escribe: cambiar nombre, cambiar tipo de documento, cambiar numero de documento, cambiar correo, cambiar numero, cambiar modalidad, cambiar dia o cambiar hora.',
      patch: { intent: 'consulta_laboral', step: 'confirm_appointment', profile },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'confirm_waiting' },
    };
  }

  if (state.stage === 'awaiting_category') {
    if (isLaboralSelection(input.text)) {
      conversationStore.set(key, { stage: 'awaiting_question', category: 'laboral', profile: state.profile ?? {} });
      return {
        responseText: 'Perfecto. Escribe tu consulta laboral.',
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile: state.profile ?? {} },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', category: 'laboral' },
      };
    }

    if (isAppointmentSelection(input.text)) {
      conversationStore.set(key, { stage: 'awaiting_user_full_name', category: 'laboral', profile: state.profile ?? {} });
      return {
        responseText: APPOINTMENT_USER_DATA_START_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile: state.profile ?? {} },
        payload: {
          orchestrator: true,
          correlationId: input.correlationId,
          flow: 'stateful',
          category: 'laboral',
          appointmentFlow: 'menu_direct_start',
        },
      };
    }

    if (isSoporteSelection(input.text)) {
      conversationStore.set(key, { stage: 'support', category: 'soporte', profile: state.profile ?? {} });
      return {
        responseText: 'Perfecto. Describe tu problema de soporte para ayudarte.',
        patch: { intent: 'soporte', step: 'collecting_issue', profile: state.profile ?? {} },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', category: 'soporte' },
      };
    }

    return {
      responseText: MENU_TEXT,
      patch: { intent: 'general', step: 'ask_intent', profile: state.profile ?? {} },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', category: 'unknown' },
    };
  }

  if (state.category === 'laboral' && state.stage === 'awaiting_question') {
    if (isScheduleAppointmentRequest(input.text)) {
      conversationStore.set(key, {
        stage: 'awaiting_user_full_name',
        category: 'laboral',
        profile,
      });
      return {
        responseText: APPOINTMENT_USER_DATA_START_TEXT,
        patch: { intent: 'consulta_laboral', step: 'ask_user_full_name', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', appointmentFlow: 'direct_start_collect_user' },
      };
    }

    if (isNoMoreDoubtsMessage(input.text)) {
      conversationStore.set(key, {
        stage: 'awaiting_appointment_opt',
        category: 'laboral',
        profile,
      });
      return {
        responseText: `Perfecto. ${APPOINTMENT_OFFER_TEXT}`,
        patch: { intent: 'consulta_laboral', step: 'offer_appointment', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', closureHint: true, appointmentFlow: 'offer' },
      };
    }

    if (isAnotherQuestionPrompt(input.text)) {
      return {
        responseText: `Claro, cuéntame tu otra duda y te ayudo. ${FOLLOWUP_HINT_TEXT}`,
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', awaitingNewQuestion: true },
      };
    }

    if (!env.ORCH_RAG_ENABLED) {
      return {
        responseText: 'El modo de consulta jurídica está desactivado temporalmente. Intenta en unos minutos.',
        patch: { intent: 'consulta_laboral', step: 'ask_issue', profile },
        payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', ragEnabled: false },
      };
    }

    const previousQuery = typeof profile.lastLaboralQuery === 'string' ? profile.lastLaboralQuery : '';
    const previousNoSupport = profile.lastRagNoSupport === true;
    const currentText = input.rawText.trim();

    const competence = evaluateLaboralCompetence(currentText);
    if (competence.status === 'not_competent') {
      conversationStore.clear(key);
      conversationStore.set(key, defaultState());
      return {
        responseText: `Según la información que compartes, este caso no sería competencia del consultorio laboral. ${competence.reason ?? ''} Si deseas iniciar una nueva consulta, escribe reset. ¡Hasta pronto!`,
        patch: { intent: 'general', step: 'ask_intent', profile: { policyAccepted: true } },
        payload: {
          orchestrator: true,
          correlationId: input.correlationId,
          flow: 'stateful',
          ended: true,
          competence: {
            area: 'laboral',
            status: 'not_competent',
            reason: competence.reason ?? null,
          },
        },
      };
    }

    const queryText = previousNoSupport && previousQuery
      ? `${previousQuery}\n\nDetalles adicionales del usuario: ${currentText}`
      : currentText;

    const rag = await resolveLaboralQuery({
      queryText,
      correlationId: input.correlationId,
      tenantId: input.messageIn.tenantId,
      conversationId: input.conversationId,
    });

    conversationStore.set(key, {
      stage: 'awaiting_question',
      category: 'laboral',
      profile: {
        ...profile,
        lastLaboralQuery: rag.queryUsed,
        lastRagNoSupport: rag.noSupport,
      },
    });
    return {
      responseText: rag.responseText,
      patch: {
        intent: 'consulta_laboral',
        step: 'ask_issue',
        profile: {
          ...profile,
          lastLaboralQuery: rag.queryUsed,
          lastRagNoSupport: rag.noSupport,
        },
      },
      payload: {
        orchestrator: true,
        flow: 'stateful',
        ...rag.payload,
        ragContextAugmented: previousNoSupport && Boolean(previousQuery),
      },
    };
  }

  if (state.category === 'soporte' || state.stage === 'support') {
    conversationStore.set(key, { stage: 'support', category: 'soporte', profile: { issue: input.rawText.trim() } });
    return {
      responseText: 'Gracias. Registré tu caso de soporte y te ayudaré con un asesor. Si deseas empezar de nuevo escribe reset.',
      patch: { intent: 'soporte', step: 'collecting_issue', profile: { issue: input.rawText.trim() } },
      payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', category: 'soporte' },
    };
  }

  conversationStore.set(key, defaultState());
  return {
    responseText: MENU_TEXT,
    patch: { intent: 'general', step: 'ask_intent', profile: {} },
    payload: { orchestrator: true, correlationId: input.correlationId, flow: 'stateful', fallback: true },
  };
}

export async function __testOnly_runStatefulFlow(input: {
  messageIn: MessageIn;
  conversationId: string;
  correlationId: string;
}): Promise<StatefulFlowResult> {
  const extractedText = extractText(input.messageIn);
  return runStatefulFlow({
    messageIn: input.messageIn,
    text: extractedText,
    rawText: extractedText,
    conversationId: input.conversationId,
    correlationId: input.correlationId,
  });
}

function localFallbackAI(text: string): AIResult {
  const shouldReset = text.includes('menu') || text.includes('cambiar');

  let intent: Intent = 'general';
  if (text.includes('laboral') || text.includes('trabajo') || text.includes('empleo')) {
    intent = 'consulta_laboral';
  } else if (text.includes('soporte') || text.includes('error') || text.includes('problema')) {
    intent = 'soporte';
  }

  return {
    intent: shouldReset ? 'general' : intent,
    confidence: 0,
    entities: {},
    shouldReset,
  };
}

function pickEntityCity(ai: AIResult): string | undefined {
  const city = ai.entities?.city;
  return typeof city === 'string' && city.trim() ? city.trim() : undefined;
}

function pickEntityAge(ai: AIResult): number | undefined {
  const age = ai.entities?.age;
  return typeof age === 'number' && age > 0 && age <= 120 ? age : undefined;
}

function isHardResetCommand(text: string): boolean {
  return [
    'reset',
    'reiniciar',
    'menu',
    'menú',
    'inicio',
    'empezar',
    'comenzar',
  ].includes(text);
}

function isGreeting(text: string): boolean {
  return [
    'hola',
    'holi',
    'buenas',
    'hello',
    'hi',
  ].includes(text);
}

function decideNextAction(text: string, context: OrchestratorContext, ai: AIResult): Decision {
  const shouldForceReset = isHardResetCommand(text)
    || (isGreeting(text) && context.step === 'ready_for_handoff');

  if (ai.shouldReset === true || shouldForceReset) {
    return {
      patch: { intent: 'general', step: 'ask_intent', profile: {} },
      responseText: 'Listo 👋 ¿En qué te puedo ayudar? Responde: laboral o soporte.',
      nextIntent: 'general',
      nextStep: 'ask_intent',
    };
  }

  const cityFromAI = pickEntityCity(ai);
  const ageFromAI = pickEntityAge(ai);

  if (!context.step || context.step === 'ask_intent' || !context.intent) {
    if (normalizeIntent(ai.intent) === 'consulta_laboral') {
      if (cityFromAI && ageFromAI) {
        return {
          patch: {
            intent: 'consulta_laboral',
            step: 'ready_for_handoff',
            profile: { city: cityFromAI, age: ageFromAI },
          },
          responseText: 'Listo ✅ Ya tengo tu información. Te paso con un asesor.',
          nextIntent: 'consulta_laboral',
          nextStep: 'ready_for_handoff',
        };
      }

      if (cityFromAI && !ageFromAI) {
        return {
          patch: {
            intent: 'consulta_laboral',
            step: 'ask_age',
            profile: { city: cityFromAI },
          },
          responseText: 'Gracias. ¿Cuál es tu edad?',
          nextIntent: 'consulta_laboral',
          nextStep: 'ask_age',
        };
      }

      return {
        patch: {
          intent: 'consulta_laboral',
          step: 'ask_city',
          ...(ageFromAI ? { profile: { age: ageFromAI } } : {}),
        },
        responseText: 'Perfecto. ¿En qué ciudad estás?',
        nextIntent: 'consulta_laboral',
        nextStep: 'ask_city',
      };
    }

    if (normalizeIntent(ai.intent) === 'soporte') {
      return {
        patch: { intent: 'soporte', step: 'collecting_issue' },
        responseText: 'Entendido. Cuéntame cuál es el problema.',
        nextIntent: 'soporte',
        nextStep: 'collecting_issue',
      };
    }

    return {
      patch: {
        intent: context.intent ?? 'general',
        step: 'ask_intent',
      },
      responseText: 'Para ayudarte mejor, responde: laboral o soporte.',
      nextIntent: context.intent ?? 'general',
      nextStep: 'ask_intent',
    };
  }

  if (context.intent === 'consulta_laboral') {
    if (context.step === 'ask_city') {
      const city = cityFromAI ?? text.trim();
      return {
        patch: {
          intent: 'consulta_laboral',
          step: 'ask_age',
          profile: { city },
        },
        responseText: 'Gracias. ¿Cuál es tu edad?',
        nextIntent: 'consulta_laboral',
        nextStep: 'ask_age',
      };
    }

    if (context.step === 'ask_age') {
      const age = ageFromAI ?? parseAge(text);
      if (!age) {
        return {
          patch: {
            intent: 'consulta_laboral',
            step: 'ask_age',
          },
          responseText: '¿Me confirmas tu edad en números?',
          nextIntent: 'consulta_laboral',
          nextStep: 'ask_age',
        };
      }

      return {
        patch: {
          intent: 'consulta_laboral',
          step: 'ready_for_handoff',
          profile: { age },
        },
        responseText: 'Listo ✅ Ya tengo tu información. Te paso con un asesor.',
        nextIntent: 'consulta_laboral',
        nextStep: 'ready_for_handoff',
      };
    }
  }

  if (context.intent === 'soporte') {
    return {
      patch: {
        intent: 'soporte',
        step: 'ready_for_handoff',
        profile: { issue: text },
      },
      responseText: 'Perfecto. Ya registré tu caso. Te paso con un asesor.',
      nextIntent: 'soporte',
      nextStep: 'ready_for_handoff',
    };
  }

  return {
    patch: { intent: 'general', step: 'ask_intent' },
    responseText: 'Para ayudarte mejor, responde: laboral o soporte.',
    nextIntent: 'general',
    nextStep: 'ask_intent',
  };
}

function shouldUseRag(intent: Intent, text: string): boolean {
  if (!env.ORCH_RAG_ENABLED) return false;
  if (intent !== 'consulta_laboral' && intent !== 'consulta_juridica') return false;
  return text.trim().length > 0;
}

function normalizeAnswer(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function pickRagFallbackKind(result: RagAnswerResult): RagFallbackKind {
  const normalizedAnswer = normalizeAnswer(result.answer);
  const noInfoAnswer = normalizedAnswer.includes('no tengo suficiente informacion en el documento')
    || normalizedAnswer.includes('no encontre suficiente soporte');

  if (result.status === 'no_context' && result.citations.length === 0 && result.usedChunks.length === 0) {
    return 'no_content';
  }

  if (result.status === 'low_confidence') {
    return 'needs_context';
  }

  if (noInfoAnswer) {
    if (result.citations.length === 0 && result.usedChunks.length === 0) return 'no_content';
    return 'needs_context';
  }

  return 'none';
}

function truncateForWhatsapp(text: string, max = 1300): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function sanitizeRagAnswerForUser(answer: string): string {
  const withoutChunkRefs = answer
    .replace(/\(\s*source\s*:\s*\d+\s*\)/gi, '')
    .replace(/\(\s*[a-z0-9_\- ]{2,60}\s*:\s*\d+\s*\)/gi, '');
  const withoutSourcesFooter = withoutChunkRefs.replace(/\n\nFuentes:[\s\S]*$/i, '');
  return withoutSourcesFooter.replace(/\s{2,}/g, ' ').trim();
}

function appendPreliminaryDisclaimer(text: string): string {
  if (text.includes(PRELIMINARY_GUIDANCE_DISCLAIMER)) return text;
  return `${text}\n\n${PRELIMINARY_GUIDANCE_DISCLAIMER}`;
}

function buildRagWhatsappText(result: RagAnswerResult, caseType: string): string {
  const base = sanitizeRagAnswerForUser(result.answer.trim());
  return truncateForWhatsapp(`Tipo de caso: ${caseType}\n\n${appendPreliminaryDisclaimer(base)}\n\n${FOLLOWUP_HINT_TEXT}`);
}

export const orchestratorService = {
  async handleMessage(messageIn: MessageIn, requestId?: string): Promise<OrchestratorResponse> {
    const correlationId = requestId ?? randomUUID();
    const channel = mapChannel(messageIn.channel);
    const incomingType = mapMessageType(messageIn.message.type);
    const extractedRawText = extractRawText(messageIn);
    const extractedText = extractText(messageIn);

    const contact = await conversationClient.upsertContact({
      tenantId: messageIn.tenantId,
      channel,
      externalId: messageIn.externalUserId,
      displayName: messageIn.displayName,
      requestId: correlationId,
    });

    const conversation = await conversationClient.getOrCreateConversation({
      tenantId: messageIn.tenantId,
      contactId: contact.id,
      channel,
      requestId: correlationId,
    });

    await conversationClient.createMessage({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      contactId: contact.id,
      direction: 'IN',
      type: incomingType,
      text: extractedRawText,
      payload: {
        ...(messageIn.message.payload ?? {}),
        extractedText,
        extractedRawText,
      },
      providerMessageId: messageIn.message.providerMessageId,
      requestId: correlationId,
    });

    const latestContext = await conversationClient.getLatestContext({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      requestId: correlationId,
    });
    const context = parseContext(latestContext.data);

    let ai: AIResult = localFallbackAI(extractedText);
    let patch: Record<string, unknown>;
    let responseText = '';
    let responsePayload: Record<string, unknown> = { orchestrator: true, correlationId };
    let nextIntent: Intent = 'general';
    let nextStep: Step = 'ask_intent';

    if (env.ORCH_FLOW_MODE === 'stateful') {
      const statefulResult = await runStatefulFlow({
        messageIn,
        text: extractedText,
        rawText: extractedRawText,
        conversationId: conversation.id,
        correlationId,
      });
      responseText = statefulResult.responseText;
      responsePayload = statefulResult.payload;
      patch = statefulResult.patch;
      nextIntent = normalizeIntent(typeof patch.intent === 'string' ? patch.intent : 'general');
      nextStep = typeof patch.step === 'string' ? (patch.step as Step) : 'ask_intent';
    } else {
      try {
        ai = await classifyExtract(extractedRawText);
      } catch (error) {
        log.warn(
          {
            requestId: correlationId,
            tenantId: messageIn.tenantId,
            conversationId: conversation.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'AI classify failed, using fallback',
        );
        ai = localFallbackAI(extractedText);
      }

      const decision = decideNextAction(extractedText, context, ai);
      patch = decision.patch;
      responseText = decision.responseText;
      responsePayload = { orchestrator: true, correlationId };
      nextIntent = decision.nextIntent;
      nextStep = decision.nextStep;

      const intentForRag = normalizeIntent(decision.nextIntent);
      if (shouldUseRag(intentForRag, extractedRawText)) {
        const ragStartedAt = Date.now();
        const query = extractedRawText.trim();

        try {
          const ragResult = await askRag(query, correlationId);
          const fallbackKind = pickRagFallbackKind(ragResult);
          const isNoSupport = fallbackKind !== 'none';
          responseText = fallbackKind === 'none'
            ? buildRagWhatsappText(ragResult, 'Laboral')
            : fallbackKind === 'no_content'
              ? appendPreliminaryDisclaimer(RAG_NO_CONTENT_FALLBACK)
              : appendPreliminaryDisclaimer(RAG_NEEDS_CONTEXT_FALLBACK);
          responsePayload = {
            ...responsePayload,
            rag: {
              statusCode: ragResult.statusCode,
              latencyMs: ragResult.latencyMs,
              citationsCount: ragResult.citations.length,
              usedChunksCount: ragResult.usedChunks.length,
              topChunk: ragResult.usedChunks[0]?.chunkIndex ?? null,
              noSupport: isNoSupport,
              noSupportKind: fallbackKind,
            },
          };

          log.info(
            {
              correlationId,
              tenantId: messageIn.tenantId,
              conversationId: conversation.id,
              intent: intentForRag,
              queryLen: query.length,
              querySample: query.slice(0, 40),
              ragLatencyMs: Date.now() - ragStartedAt,
              ragStatusCode: ragResult.statusCode,
            },
            'RAG response integrated',
          );
        } catch (error) {
          responseText = appendPreliminaryDisclaimer(RAG_ERROR_FALLBACK);
          responsePayload = {
            ...responsePayload,
            rag: {
              status: 'error',
              latencyMs: Date.now() - ragStartedAt,
              error: error instanceof Error ? error.message : String(error),
            },
          };

          log.warn(
            {
              correlationId,
              tenantId: messageIn.tenantId,
              conversationId: conversation.id,
              intent: intentForRag,
              queryLen: query.length,
              querySample: query.slice(0, 40),
              error: error instanceof Error ? error.message : String(error),
            },
            'RAG call failed, fallback response used',
          );
        }
      }
    }

    log.info(
      {
        requestId: correlationId,
        correlationId,
        tenantId: messageIn.tenantId,
        conversationId: conversation.id,
        stepBefore: context.step ?? null,
        intentBefore: context.intent ?? null,
        stepAfter: nextStep,
        intentAfter: nextIntent,
        extractedText,
        extractedRawText,
        category: (responsePayload.category as string | undefined)
          ?? (nextIntent === 'consulta_laboral' ? 'laboral' : nextIntent === 'soporte' ? 'soporte' : null),
        flowMode: env.ORCH_FLOW_MODE,
        shouldReset: ai.shouldReset ?? false,
      },
      'Orchestrator decision computed',
    );

    await conversationClient.patchContext({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      patch,
      requestId: correlationId,
    });

    const responses: MessageOut[] = [{ type: 'text', text: responseText, payload: responsePayload }];

    responsePayload = {
      ...responsePayload,
      debug: {
        correlationId,
        extractedText,
        extractedRawText,
        category: responsePayload.category ?? null,
        stepBefore: context.step ?? null,
        intentBefore: context.intent ?? null,
        stepAfter: nextStep,
        intentAfter: nextIntent,
        flowMode: env.ORCH_FLOW_MODE,
      },
    };

    responses[0].payload = responsePayload;

    await conversationClient.createMessage({
      tenantId: messageIn.tenantId,
      conversationId: conversation.id,
      contactId: contact.id,
      direction: 'OUT',
      type: 'TEXT',
      text: responseText,
      payload: responsePayload,
      requestId: correlationId,
    });

    return {
      conversationId: conversation.id,
      contactId: contact.id,
      correlationId,
      responses,
    };
  },
};
