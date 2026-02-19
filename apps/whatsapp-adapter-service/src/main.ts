import express from 'express';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import { z } from 'zod';

config();

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3050),
  ORCHESTRATOR_URL: z.string().url().default('http://localhost:3022/v1/orchestrator/handle-message'),
  TENANT_ID: z.string().min(1),
  CHANNEL: z.enum(['WEBCHAT', 'WHATSAPP']).default('WEBCHAT'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_POLLING_ENABLED: z.coerce.boolean().default(true),
  TELEGRAM_POLL_TIMEOUT_S: z.coerce.number().int().min(1).max(60).default(25),
});

const env = EnvSchema.parse(process.env);

type OrchestratorMessageOut = {
  type?: string;
  text?: string;
  payload?: Record<string, unknown>;
};

type OrchestratorPayload = {
  correlationId?: string;
  responses?: OrchestratorMessageOut[];
  replyText?: string;
  message?: string;
  response?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    date?: number;
    text?: string;
    from?: { id: number; first_name?: string; last_name?: string; username?: string };
    chat?: { id: number; type?: string };
  };
};

const processedUpdateIds = new Set<number>();
let polling = false;
let lastError: string | null = null;
let lastUpdateId = 0;

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
  const priorities: Record<typeof env.LOG_LEVEL, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  if (priorities[level] < priorities[env.LOG_LEVEL]) return;
  const extra = meta ? ` ${JSON.stringify(meta)}` : '';
  const line = `[telegram-adapter] ${level.toUpperCase()} ${message}${extra}`;
  if (level === 'error') console.error(line); else console.log(line);
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

function formatDisplayName(update: TelegramUpdate): string {
  const first = update.message?.from?.first_name?.trim() ?? '';
  const last = update.message?.from?.last_name?.trim() ?? '';
  const username = update.message?.from?.username?.trim() ?? '';
  const byName = `${first} ${last}`.trim();
  return byName || username || 'Telegram User';
}

function getTelegramApiUrl(method: string): string {
  return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
}

async function callTelegram(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(getTelegramApiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`telegram_${method}_status_${res.status}: ${raw}`);
  const json = JSON.parse(raw);
  if (!json.ok) throw new Error(`telegram_${method}_failed: ${raw}`);
  return json.result;
}

async function callOrchestrator(input: {
  from: string;
  displayName: string;
  body: string;
  providerMessageId: string;
  correlationId: string;
}): Promise<OrchestratorPayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  const payload = {
    tenantId: env.TENANT_ID,
    channel: env.CHANNEL.toLowerCase(),
    externalUserId: input.from,
    displayName: input.displayName,
    message: {
      type: 'text',
      text: input.body,
      providerMessageId: input.providerMessageId,
      payload: { source: 'telegram-bot-api' },
    },
  };

  try {
    const response = await fetch(env.ORCHESTRATOR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'x-correlation-id': input.correlationId,
        'x-request-id': input.correlationId,
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

async function processUpdate(update: TelegramUpdate): Promise<void> {
  if (processedUpdateIds.has(update.update_id)) return;
  processedUpdateIds.add(update.update_id);

  const message = update.message;
  if (!message?.text || !message.chat?.id || !message.from?.id) return;

  const correlationId = `${message.from.id}-${message.message_id}-${randomUUID()}`;
  const providerMessageId = String(message.message_id);
  const from = `telegram:${message.from.id}`;
  const body = message.text.trim();
  if (!body) return;

  const startedAt = Date.now();
  log('info', 'incoming_message', {
    updateId: update.update_id,
    from,
    providerMessageId,
    correlationId,
    text: truncateText(body),
  });

  try {
    const orchestratorRes = await callOrchestrator({
      from,
      displayName: formatDisplayName(update),
      body,
      providerMessageId,
      correlationId,
    });

    const reply = extractReplyText(orchestratorRes);
    await callTelegram('sendMessage', {
      chat_id: message.chat.id,
      text: reply,
      disable_web_page_preview: true,
    });

    log('info', 'orchestrator_replied', {
      updateId: update.update_id,
      from,
      providerMessageId,
      correlationId,
      latencyMs: Date.now() - startedAt,
      status: 'ok',
    });
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    log('error', 'message_processing_failed', {
      updateId: update.update_id,
      from,
      providerMessageId,
      correlationId,
      error: lastError,
      latencyMs: Date.now() - startedAt,
    });

    try {
      await callTelegram('sendMessage', {
        chat_id: message.chat.id,
        text: 'En este momento no puedo procesar tu solicitud, intenta más tarde.',
      });
    } catch (sendErr) {
      log('error', 'fallback_message_failed', {
        error: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
    }
  }
}

async function pollUpdates(): Promise<void> {
  if (!env.TELEGRAM_POLLING_ENABLED) {
    log('info', 'telegram_polling_disabled');
    return;
  }

  polling = true;
  log('info', 'telegram_polling_started', { timeoutSeconds: env.TELEGRAM_POLL_TIMEOUT_S });

  while (polling) {
    try {
      const updates = await callTelegram('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: env.TELEGRAM_POLL_TIMEOUT_S,
        allowed_updates: ['message'],
      }) as TelegramUpdate[];

      for (const update of updates) {
        lastUpdateId = Math.max(lastUpdateId, update.update_id);
        await processUpdate(update);
      }
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      log('error', 'telegram_polling_error', { error: lastError });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

const app = express();
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/ready', (_req, res) => {
  res.status(200).json({
    ready: polling,
    lastError,
    provider: 'telegram-bot-api',
    lastUpdateId,
  });
});

app.listen(env.PORT, () => {
  log('info', 'http_server_started', {
    port: env.PORT,
    provider: 'telegram-bot-api',
    channel: env.CHANNEL,
  });
  void pollUpdates();
});
