import express from 'express';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import path from 'path';
import { z } from 'zod';

config();

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3051),
  ORCHESTRATOR_URL: z.string().url().default('http://localhost:3022/v1/orchestrator/handle-message'),
  TENANT_ID: z.string().min(1),
  CHANNEL: z.enum(['WHATSAPP', 'WEBCHAT']).default('WHATSAPP'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  WHATSAPP_SESSION_DIR: z.string().min(1).default('./bot_sessions'),
  WHATSAPP_USE_PAIRING_CODE: z.coerce.boolean().default(true),
  WHATSAPP_PHONE_NUMBER: z.string().optional(),
  WHATSAPP_PAIRING_INTERVAL_MS: z.coerce.number().int().min(3000).max(30000).default(8000),
  WHATSAPP_AUTO_PAIRING_ON_BOOT: z.coerce.boolean().default(false),
  WHATSAPP_RECONNECT_ON_405: z.coerce.boolean().default(false),
});

const env = EnvSchema.parse(process.env);

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type SocketLike = {
  ev: { on: (event: string, listener: (...args: any[]) => void) => void };
  user?: { id?: string };
  requestPairingCode?: (phone: string) => Promise<string>;
  sendMessage: (jid: string, payload: { text: string }) => Promise<unknown>;
};

type OrchestratorMessageOut = { text?: string };
type OrchestratorPayload = {
  responses?: OrchestratorMessageOut[];
  replyText?: string;
  message?: string;
  response?: string;
};

let socket: SocketLike | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let pairingTimer: NodeJS.Timeout | null = null;
let pairingRequestTimer: NodeJS.Timeout | null = null;
let booting = false;
let connectionState: 'open' | 'close' | 'connecting' | 'unknown' = 'unknown';
let isReady = false;
let lastError: string | null = null;
let lastPairingCode: string | null = null;
let lastPairingCodeAt = 0;
let lastQr: string | null = null;
let lastDisconnectCode: number | null = null;
let forceQrMode = false;
const processedMessageIds = new Set<string>();

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const priorities: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  if (priorities[level] < priorities[env.LOG_LEVEL]) return;
  const extra = meta ? ` ${JSON.stringify(meta)}` : '';
  const line = `[whatsapp-adapter] ${level.toUpperCase()} ${message}${extra}`;
  if (level === 'error') console.error(line); else console.log(line);
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function getPairingPhoneCandidates(): string[] {
  const raw = normalizePhone(env.WHATSAPP_PHONE_NUMBER ?? '');
  if (!raw) return [];
  const values = new Set<string>();
  values.add(raw);
  if (raw.length === 10) values.add(`57${raw}`);
  if (raw.startsWith('57') && raw.length === 12) values.add(raw.slice(2));
  return Array.from(values).filter((p) => p.length >= 10 && p.length <= 15);
}

function extractReplyText(payload: OrchestratorPayload): string {
  if (Array.isArray(payload.responses) && payload.responses.length > 0) {
    const first = payload.responses.find((m) => typeof m.text === 'string' && m.text.trim().length > 0);
    if (first?.text) return first.text;
  }
  if (typeof payload.replyText === 'string' && payload.replyText.trim()) return payload.replyText;
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  if (typeof payload.response === 'string' && payload.response.trim()) return payload.response;
  return 'En este momento no puedo procesar tu solicitud, intenta mas tarde.';
}

function extractIncomingText(msg: any): string {
  const m = msg?.message ?? {};
  return String(
    m?.conversation ??
      m?.extendedTextMessage?.text ??
      m?.imageMessage?.caption ??
      m?.videoMessage?.caption ??
      m?.buttonsResponseMessage?.selectedDisplayText ??
      m?.listResponseMessage?.title ??
      m?.templateButtonReplyMessage?.selectedDisplayText ??
      '',
  ).trim();
}

async function callOrchestrator(input: {
  telefono: string;
  body: string;
  displayName: string;
  providerMessageId: string;
  correlationId: string;
}): Promise<OrchestratorPayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(env.ORCHESTRATOR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'x-correlation-id': input.correlationId,
        'x-request-id': input.correlationId,
      },
      body: JSON.stringify({
        tenantId: env.TENANT_ID,
        channel: env.CHANNEL.toLowerCase(),
        externalUserId: `whatsapp:${input.telefono}`,
        displayName: input.displayName,
        message: {
          type: 'text',
          text: input.body,
          providerMessageId: input.providerMessageId,
          payload: { source: 'baileys' },
        },
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`orchestrator_status_${response.status}: ${text}`);
    const parsed = JSON.parse(text) as { data?: OrchestratorPayload } | OrchestratorPayload;
    return (parsed as { data?: OrchestratorPayload }).data ?? (parsed as OrchestratorPayload);
  } finally {
    clearTimeout(timer);
  }
}

async function requestPairingCode(): Promise<string | null> {
  if (!env.WHATSAPP_USE_PAIRING_CODE) return null;
  if (!socket?.requestPairingCode) return null;
  if (connectionState === 'close') return null;

  const candidates = getPairingPhoneCandidates();
  if (candidates.length === 0) {
    throw new Error('WHATSAPP_PHONE_NUMBER requerido para generar codigo');
  }

  for (const phone of candidates) {
    try {
      const code = await socket.requestPairingCode(phone);
      lastPairingCode = code;
      lastPairingCodeAt = Date.now();
      lastError = null;
      log('info', 'pairing_code_ready', { code, phone });
      return code;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('warn', 'pairing_code_attempt_failed', { phone, error: msg });
      lastError = msg;
    }
  }
  return null;
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startSocket();
  }, 6000);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function onIncomingMessage(msg: any): Promise<void> {
  if (!socket) return;
  if (msg?.key?.fromMe) return;

  const remoteJid = String(msg?.key?.remoteJid ?? '');
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return;

  const providerMessageId = String(msg?.key?.id ?? randomUUID());
  if (processedMessageIds.has(providerMessageId)) return;
  processedMessageIds.add(providerMessageId);

  const telefono = normalizePhone(remoteJid.split('@')[0] ?? '');
  const text = extractIncomingText(msg);
  if (!telefono || !text) return;

  const correlationId = `${telefono}-${providerMessageId}-${randomUUID()}`;

  try {
    const orchestrator = await callOrchestrator({
      telefono,
      body: text,
      displayName: String(msg?.pushName ?? 'WhatsApp User'),
      providerMessageId,
      correlationId,
    });

    const reply = extractReplyText(orchestrator);
    await socket.sendMessage(remoteJid, { text: reply });
  } catch (err) {
    const msgError = err instanceof Error ? err.message : String(err);
    lastError = msgError;
    log('error', 'incoming_process_failed', { error: msgError, telefono });
  }
}

async function startSocket(): Promise<void> {
  if (booting) return;
  booting = true;

  try {
    const baileys = require('@whiskeysockets/baileys') as any;
    const qrcodeTerminal = require('qrcode-terminal') as { generate: (qr: string, opts: { small: boolean }) => void };
    const pino = require('pino') as (opts?: Record<string, unknown>) => any;

    const makeWASocket = typeof baileys === 'function' ? baileys : baileys.default;
    const useMultiFileAuthState = baileys.useMultiFileAuthState;
    const DisconnectReason = baileys.DisconnectReason;
    const Browsers = baileys.Browsers;

    const sessionDir = path.resolve(process.cwd(), env.WHATSAPP_SESSION_DIR);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const usePairingCode = env.WHATSAPP_USE_PAIRING_CODE && !forceQrMode;

    socket = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      browser: typeof Browsers?.ubuntu === 'function' ? Browsers.ubuntu('Chrome') : ['Ubuntu', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      defaultQueryTimeoutMs: 60000,
      logger: pino({ level: 'silent' }),
    }) as SocketLike;

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('messages.upsert', (ev: any) => {
      const messages = Array.isArray(ev?.messages) ? ev.messages : [];
      for (const m of messages) void onIncomingMessage(m);
    });

    socket.ev.on('connection.update', (update: any) => {
      const { connection, lastDisconnect, qr } = update ?? {};

      if (connection === 'connecting') {
        connectionState = 'connecting';
        if (usePairingCode && !state.creds.registered && !lastPairingCode && !pairingRequestTimer) {
          pairingRequestTimer = setTimeout(() => {
            pairingRequestTimer = null;
            void requestPairingCode();
          }, 700);
        }
      }

      if (qr && !usePairingCode) {
        lastQr = qr;
        qrcodeTerminal.generate(qr, { small: true });
        log('info', 'qr_ready');
      }

      if (qr && usePairingCode) {
        lastQr = qr;
        log('info', 'qr_also_available', { note: 'Si falla codigo, escanea QR en terminal' });
      }

      if (connection === 'open') {
        isReady = true;
        connectionState = 'open';
        lastError = null;
        lastQr = null;
        log('info', 'whatsapp_connected', { userId: socket?.user?.id });
      }

      if (connection === 'close') {
        isReady = false;
        connectionState = 'close';
        if (pairingRequestTimer) {
          clearTimeout(pairingRequestTimer);
          pairingRequestTimer = null;
        }

        const statusCode = Number(lastDisconnect?.error?.output?.statusCode ?? 0);
        const reason = lastDisconnect?.error?.message ?? 'connection_closed';
        lastDisconnectCode = statusCode;
        lastError = String(reason);
        log('warn', 'whatsapp_disconnected', { statusCode, reason });

        if (statusCode === 405) {
          if (usePairingCode && !forceQrMode) {
            forceQrMode = true;
            lastPairingCode = null;
            lastPairingCodeAt = 0;
            log('warn', 'switching_to_qr_mode_after_405', {
              message: 'WhatsApp rechaza pairing-code en esta sesion. Cambiando a QR automaticamente.',
            });
            scheduleReconnect();
            return;
          }

          if (!env.WHATSAPP_RECONNECT_ON_405) {
            log('warn', 'reconnect_paused_for_405', { message: 'Intenta escanear QR y evita regenerar codigo continuamente' });
            return;
          }
        }

        if (statusCode !== Number(DisconnectReason?.loggedOut ?? 401) || usePairingCode) scheduleReconnect();
      }
    });

    if (usePairingCode && env.WHATSAPP_AUTO_PAIRING_ON_BOOT && !state.creds.registered) {
      if (pairingTimer) clearInterval(pairingTimer);
      pairingTimer = setInterval(() => {
        if (state.creds.registered || lastPairingCode || !socket || connectionState === 'close') return;
        if (pairingRequestTimer) return;
        pairingRequestTimer = setTimeout(() => {
          pairingRequestTimer = null;
          void requestPairingCode();
        }, 5000);
      }, env.WHATSAPP_PAIRING_INTERVAL_MS);

      setTimeout(() => {
        if (!state.creds.registered && !lastPairingCode) {
          void requestPairingCode();
        }
      }, 900);
    }

    log('info', 'baileys_started', {
      sessionDir: env.WHATSAPP_SESSION_DIR,
      usePairingCode,
      forceQrMode,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastError = msg;
    log('error', 'socket_start_failed', { error: msg });
    scheduleReconnect();
  } finally {
    if (pairingRequestTimer) {
      clearTimeout(pairingRequestTimer);
      pairingRequestTimer = null;
    }
    booting = false;
  }
}

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'whatsapp-adapter-service' }));

app.get('/ready', (_req, res) => {
  res.status(200).json({
    ready: isReady,
    connectionState,
    lastError,
    hasQr: Boolean(lastQr),
    hasPairingCode: Boolean(lastPairingCode),
    lastPairingCodeAt,
    lastDisconnectCode,
    forceQrMode,
  });
});

app.get('/pairing-code', async (_req, res) => {
  try {
    if (forceQrMode) {
      return res.status(409).json({ ok: false, error: 'PAIRING_DISABLED_AFTER_405', message: 'Usa QR para vincular esta sesion' });
    }
    const fresh = Date.now() - lastPairingCodeAt < 60000;
    const code = (await requestPairingCode()) ?? (fresh ? lastPairingCode : null);
    if (!code) return res.status(409).json({ ok: false, error: 'PAIRING_NOT_READY' });
    return res.status(200).json({ ok: true, code, generatedAt: lastPairingCodeAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

app.get('/qr', (_req, res) => {
  if (!lastQr) {
    return res.status(409).json({ ok: false, error: 'QR_NOT_READY' });
  }
  return res.status(200).json({ ok: true, qr: lastQr });
});

app.post('/pairing-mode/code', (_req, res) => {
  forceQrMode = false;
  lastPairingCode = null;
  lastPairingCodeAt = 0;
  void startSocket();
  return res.status(200).json({ ok: true, mode: 'pairing-code' });
});

app.post('/pairing-code/refresh', async (_req, res) => {
  try {
    if (forceQrMode) {
      return res.status(409).json({ ok: false, error: 'PAIRING_DISABLED_AFTER_405', message: 'Usa QR para vincular esta sesion' });
    }
    if (connectionState === 'close' || !socket) {
      void startSocket();
      await sleep(2000);
    }
    lastPairingCode = null;
    lastPairingCodeAt = 0;
    const code = await requestPairingCode();
    if (!code) return res.status(409).json({ ok: false, error: 'PAIRING_NOT_READY' });
    return res.status(200).json({ ok: true, code, generatedAt: lastPairingCodeAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

app.listen(env.PORT, () => {
  log('info', 'http_server_started', { port: env.PORT, channel: env.CHANNEL });
  void startSocket();
});
