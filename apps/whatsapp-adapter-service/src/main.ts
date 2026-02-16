import express from 'express';
import { config } from 'dotenv';
import {
  addKeyword,
  createBot,
  createFlow,
  createProvider,
  EVENTS,
  MemoryDB,
} from '@builderbot/bot';
import { BaileysProvider } from '@builderbot/provider-baileys';
import { z } from 'zod';

config();

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3050),
  ORCHESTRATOR_URL: z.string().url().default('http://localhost:3022/v1/orchestrator/handle-message'),
  TENANT_ID: z.string().min(1),
  CHANNEL: z.enum(['WHATSAPP']).default('WHATSAPP'),
  PHONE_NUMBER: z.string().min(7),
  BAILEYS_USE_PAIRING_CODE: z.coerce.boolean().default(true),
  BAILEYS_SESSION_PATH: z.string().min(1).default('./.sessions'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const env = EnvSchema.parse(process.env);

let lastPairingCode: string | null = null;
let lastPairingAt: string | null = null;
let lastPairingError: string | null = null;
let isWhatsAppReady = false;
let pairingRequestInFlight = false;
let currentVendor: any = null;
const PAIRING_CODE_CACHE_MS = 55_000;
const PAIRING_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

type OrchestratorMessageOut = {
  type?: string;
  text?: string;
  payload?: Record<string, unknown>;
};

type OrchestratorPayload = {
  conversationId?: string;
  contactId?: string;
  responses?: OrchestratorMessageOut[];
  replyText?: string;
  message?: string;
  response?: string;
};

const processedMessageIds = new Map<string, number>();
const DEDUPE_TTL_MS = 60_000;

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
  const priorities: Record<typeof env.LOG_LEVEL, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };
  if (priorities[level] < priorities[env.LOG_LEVEL]) return;

  const extra = meta ? ` ${JSON.stringify(meta)}` : '';
  const line = `[whatsapp-adapter] ${level.toUpperCase()} ${message}${extra}`;
  if (level === 'error') {
    console.error(line);
    return;
  }
  console.log(line);
}

function sanitizePhoneNumber(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, '');
}

function isVendorAuthenticated(vendor: any): boolean {
  const hasUser = Boolean(vendor?.user);
  const isRegistered = Boolean(vendor?.authState?.creds?.registered);
  return hasUser || isRegistered;
}

function extractErrorMessage(error: unknown): string {
  if (!error) return 'unknown_error';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  const maybeObj = error as {
    message?: unknown;
    output?: { statusCode?: unknown; payload?: { message?: unknown } };
    data?: { reason?: unknown };
  };

  const message = maybeObj.message ?? maybeObj.output?.payload?.message ?? maybeObj.data?.reason;
  const statusCode = maybeObj.output?.statusCode;

  if (typeof message === 'string' && message.trim().length > 0) {
    return typeof statusCode === 'number' ? `${message} (status:${statusCode})` : message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function logPairingCode(pairingCode: string): void {
  console.log(`[whatsapp-adapter] PAIRING CODE: ${pairingCode}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasRecentPairingCode(): boolean {
  if (!lastPairingCode || !lastPairingAt) return false;
  const issuedAtMs = new Date(lastPairingAt).getTime();
  if (Number.isNaN(issuedAtMs)) return false;
  return Date.now() - issuedAtMs <= PAIRING_CODE_CACHE_MS;
}

function cleanupProcessedIds(now = Date.now()): void {
  for (const [id, ts] of processedMessageIds.entries()) {
    if (now - ts > DEDUPE_TTL_MS) {
      processedMessageIds.delete(id);
    }
  }
}

function isDuplicate(providerMessageId: string): boolean {
  const now = Date.now();
  cleanupProcessedIds(now);

  const previous = processedMessageIds.get(providerMessageId);
  if (previous && now - previous <= DEDUPE_TTL_MS) {
    return true;
  }

  processedMessageIds.set(providerMessageId, now);
  return false;
}

function normalizeExternalUserId(raw: string): string {
  return raw.replace(/@s\.whatsapp\.net$/, '').trim();
}

function truncateText(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function extractReplyText(payload: OrchestratorPayload): string {
  if (Array.isArray(payload.responses) && payload.responses.length > 0) {
    const firstText = payload.responses.find((msg) => typeof msg.text === 'string' && msg.text.trim().length > 0);
    if (firstText?.text) return firstText.text;
  }

  if (typeof payload.replyText === 'string' && payload.replyText.trim().length > 0) return payload.replyText;
  if (typeof payload.message === 'string' && payload.message.trim().length > 0) return payload.message;
  if (typeof payload.response === 'string' && payload.response.trim().length > 0) return payload.response;

  return 'En este momento no puedo procesar tu solicitud, intenta más tarde.';
}

async function callOrchestrator(input: {
  from: string;
  pushName?: string;
  body: string;
  providerMessageId: string;
}): Promise<OrchestratorPayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  const payload = {
    tenantId: env.TENANT_ID,
    channel: env.CHANNEL.toLowerCase(),
    externalUserId: normalizeExternalUserId(input.from),
    displayName: input.pushName ?? 'WhatsApp User',
    message: {
      type: 'text',
      text: input.body,
      providerMessageId: input.providerMessageId,
      payload: { source: 'whatsapp-baileys' },
    },
  };

  try {
    const response = await fetch(env.ORCHESTRATOR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`orchestrator_status_${response.status}: ${responseText}`);
    }

    const json = JSON.parse(responseText) as { data?: OrchestratorPayload } | OrchestratorPayload;
    return (json as { data?: OrchestratorPayload }).data ?? (json as OrchestratorPayload);
  } finally {
    clearTimeout(timer);
  }
}

async function bootstrap(): Promise<void> {
  const sanitizedPhoneNumber = sanitizePhoneNumber(env.PHONE_NUMBER);

  const adapterProvider = createProvider(BaileysProvider as any, {
    usePairingCode: env.BAILEYS_USE_PAIRING_CODE,
    phoneNumber: sanitizedPhoneNumber,
    sessionPath: env.BAILEYS_SESSION_PATH,
  });

  const ensurePairingCode = async (reason: string): Promise<string | null> => {
    if (!env.BAILEYS_USE_PAIRING_CODE) return null;
    if (isWhatsAppReady) return null;
    if (hasRecentPairingCode()) return lastPairingCode;
    if (pairingRequestInFlight) return lastPairingCode;

    const vendor = currentVendor ?? (adapterProvider as any)?.vendor;
    if (!vendor) {
      lastPairingError = 'Socket Baileys aun no disponible.';
      return null;
    }

    if (typeof vendor.requestPairingCode !== 'function') {
      lastPairingError = 'La version actual del provider no soporta requestPairingCode.';
      return null;
    }

    if (isVendorAuthenticated(vendor)) {
      lastPairingCode = null;
      lastPairingError = null;
      return null;
    }

    pairingRequestInFlight = true;

    try {
      const pairingCode = await vendor.requestPairingCode(sanitizedPhoneNumber);
      lastPairingCode = String(pairingCode ?? '').trim() || null;
      lastPairingAt = new Date().toISOString();

      if (!lastPairingCode) {
        lastPairingError = 'Baileys no devolvio pairing code.';
        return null;
      }

      lastPairingError = null;
      logPairingCode(lastPairingCode);
      log('info', 'pairing_code_generated', {
        reason,
        phoneNumber: sanitizedPhoneNumber,
        pairingAt: lastPairingAt,
      });
      return lastPairingCode;
    } catch (error) {
      lastPairingError = extractErrorMessage(error);
      log('error', 'pairing_code_generation_failed', {
        reason,
        error: lastPairingError,
        hint: 'Verifica PHONE_NUMBER, conectividad y estado de la sesion.',
      });
      if (env.LOG_LEVEL === 'debug' && error instanceof Error && error.stack) {
        log('debug', 'pairing_code_generation_stack', { reason, stack: error.stack });
      }
      return null;
    } finally {
      pairingRequestInFlight = false;
    }
  };

  const ensurePairingCodeWithRetry = async (): Promise<void> => {
    if (!env.BAILEYS_USE_PAIRING_CODE) return;

    for (let attempt = 0; attempt <= PAIRING_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const pairingCode = await ensurePairingCode(`startup_attempt_${attempt + 1}`);
        if (pairingCode || isWhatsAppReady) return;
      } catch (error) {
        const message = extractErrorMessage(error);
        lastPairingError = message;
        log('error', 'startup_pairing_attempt_failed', { attempt: attempt + 1, error: message });
      }

      if (attempt < PAIRING_RETRY_DELAYS_MS.length) {
        await sleep(PAIRING_RETRY_DELAYS_MS[attempt]);
      }
    }
  };

  const setupPairingTracking = (): void => {
    const probe = setInterval(() => {
      const vendor = (adapterProvider as any)?.vendor;
      if (!vendor) return;

      clearInterval(probe);
      currentVendor = vendor;

      if (isVendorAuthenticated(vendor)) {
        log('info', 'whatsapp_session_detected_waiting_connection_open');
      }

      if ((vendor as any).ev?.on) {
        (vendor as any).ev.on('connection.update', async (update: any) => {
          const connection = update?.connection as string | undefined;
          const disconnectError = update?.lastDisconnect?.error;

          if (env.LOG_LEVEL === 'debug') {
            log('debug', 'baileys_connection_update', {
              connection,
              hasUser: Boolean((vendor as any).user),
              isRegistered: Boolean((vendor as any).authState?.creds?.registered),
              isNewLogin: Boolean(update?.isNewLogin),
              lastDisconnectError: disconnectError ? extractErrorMessage(disconnectError) : null,
            });
          }

          if (connection === 'connecting' || connection === 'open' || connection === 'close') {
            log('info', 'baileys_connection_state', { connection });
          }

          if (disconnectError) {
            lastPairingError = extractErrorMessage(disconnectError);
            log('error', 'baileys_connection_error', { error: lastPairingError });
          }

          if (connection === 'open') {
            isWhatsAppReady = true;
            lastPairingCode = null;
            lastPairingError = null;
            return;
          }

          if (connection === 'close') {
            isWhatsAppReady = false;
            await ensurePairingCode('connection_close');
            return;
          }

          if (connection === 'connecting') {
            isWhatsAppReady = false;
            await ensurePairingCode('connection_connecting');
          }
        });
      }

      void ensurePairingCodeWithRetry();
    }, 1000);
  };

  const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(async (ctx: any, { flowDynamic }: { flowDynamic: (message: string) => Promise<void> }) => {
    const providerMessageId = String((ctx as { id?: string }).id ?? `${Date.now()}-${ctx.from}`);
    const text = String(ctx.body ?? '').trim();

    if (!text) return;

    if (isDuplicate(providerMessageId)) {
      log('debug', 'duplicate_message_ignored', {
        from: ctx.from,
        providerMessageId,
      });
      return;
    }

    const startedAt = Date.now();
    log('info', 'incoming_message', {
      from: ctx.from,
      providerMessageId,
      text: truncateText(text),
    });

    try {
      const orchestratorRes = await callOrchestrator({
        from: ctx.from,
        pushName: (ctx as { pushName?: string }).pushName,
        body: text,
        providerMessageId,
      });

      const reply = extractReplyText(orchestratorRes);
      await flowDynamic(reply);

      log('info', 'orchestrator_replied', {
        from: ctx.from,
        providerMessageId,
        status: 'ok',
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      log('error', 'orchestrator_error', {
        from: ctx.from,
        providerMessageId,
        status: 'error',
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });

      await flowDynamic('En este momento no puedo procesar tu solicitud, intenta más tarde.');
    }
  });

  await createBot({
    flow: createFlow([welcomeFlow]),
    provider: adapterProvider,
    database: new MemoryDB(),
  });

  setupPairingTracking();

  const app = express();
  app.get('/health', (_req, res) => res.status(200).send('ok'));
  app.get('/ready', (_req, res) => {
    res.status(200).json({
      ready: isWhatsAppReady,
      lastError: lastPairingError,
    });
  });

  const buildPairingPayload = () => ({
    usePairingCode: env.BAILEYS_USE_PAIRING_CODE,
    phoneNumber: sanitizedPhoneNumber,
    sessionPath: env.BAILEYS_SESSION_PATH,
    ready: isWhatsAppReady,
    pairingCode: env.BAILEYS_USE_PAIRING_CODE && !isWhatsAppReady ? lastPairingCode : null,
    pairingAt: lastPairingAt,
    error: env.BAILEYS_USE_PAIRING_CODE ? lastPairingError : null,
  });

  app.get('/pairing-code', async (_req, res) => {
    if (env.BAILEYS_USE_PAIRING_CODE && !isWhatsAppReady) {
      await ensurePairingCode('http_pairing_code_endpoint');
    }

    res.status(200).json({
      ...buildPairingPayload(),
    });
  });
  app.get('/pairing', async (_req, res) => {
    if (env.BAILEYS_USE_PAIRING_CODE && !isWhatsAppReady) {
      await ensurePairingCode('http_pairing_endpoint');
    }

    res.status(200).json({
      ready: isWhatsAppReady,
      phoneNumber: sanitizedPhoneNumber,
      sessionPath: env.BAILEYS_SESSION_PATH,
      usePairingCode: env.BAILEYS_USE_PAIRING_CODE,
    });
  });

  app.listen(env.PORT, () => {
    log('info', 'http_control_server_started', { port: env.PORT });
    log('info', 'baileys_pairing_mode', {
      usePairingCode: env.BAILEYS_USE_PAIRING_CODE,
      phoneNumber: sanitizedPhoneNumber,
      sessionPath: env.BAILEYS_SESSION_PATH,
    });
  });
}

bootstrap().catch((error) => {
  log('error', 'bootstrap_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
