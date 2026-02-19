import crypto from 'crypto';
import express from 'express';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import { z } from 'zod';

config();

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3050),
  ORCHESTRATOR_URL: z.string().url().default('http://localhost:3022/v1/orchestrator/handle-message'),
  TENANT_ID: z.string().min(1),
  CHANNEL: z.enum(['WHATSAPP']).default('WHATSAPP'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  META_VERIFY_TOKEN: z.string().min(1),
  META_GRAPH_VERSION: z.string().min(1).default('v21.0'),
  META_PHONE_NUMBER_ID: z.string().min(1),
  META_ACCESS_TOKEN: z.string().min(1),
  META_APP_SECRET: z.string().optional(),
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

type IncomingMessage = {
  from: string;
  text: string;
  providerMessageId: string;
  pushName?: string;
};

const processedMessageIds = new Map<string, number>();
const DEDUPE_TTL_MS = 60_000;

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
  const priorities: Record<typeof env.LOG_LEVEL, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  if (priorities[level] < priorities[env.LOG_LEVEL]) return;
  const extra = meta ? ` ${JSON.stringify(meta)}` : '';
  const line = `[whatsapp-adapter] ${level.toUpperCase()} ${message}${extra}`;
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

function normalizeExternalUserId(raw: string): string {
  return raw.replace(/@s\.whatsapp\.net$/, '').trim();
}

function truncateText(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
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
  if (previous && now - previous <= DEDUPE_TTL_MS) return true;
  processedMessageIds.set(providerMessageId, now);
  return false;
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

function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.META_APP_SECRET) return true;
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', env.META_APP_SECRET).update(rawBody).digest('hex');
  const received = signatureHeader.replace('sha256=', '');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  } catch {
    return false;
  }
}

function extractIncomingMessages(payload: any): IncomingMessage[] {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const messages: IncomingMessage[] = [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const incoming = Array.isArray(value?.messages) ? value.messages : [];
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const namesByWaId = new Map<string, string>();
      for (const contact of contacts) {
        const waId = String(contact?.wa_id ?? '').trim();
        const name = String(contact?.profile?.name ?? '').trim();
        if (waId && name) namesByWaId.set(waId, name);
      }

      for (const msg of incoming) {
        const from = String(msg?.from ?? '').trim();
        const id = String(msg?.id ?? '').trim();
        const type = String(msg?.type ?? '').trim();
        if (!from || !id) continue;

        let text = '';
        if (type === 'text') {
          text = String(msg?.text?.body ?? '').trim();
        } else if (type === 'interactive') {
          text = String(
            msg?.interactive?.button_reply?.title
            ?? msg?.interactive?.list_reply?.title
            ?? msg?.interactive?.button_reply?.id
            ?? msg?.interactive?.list_reply?.id
            ?? ''
          ).trim();
        }

        if (!text) continue;

        messages.push({
          from,
          text,
          providerMessageId: id,
          pushName: namesByWaId.get(from),
        });
      }
    }
  }

  return messages;
}

async function callOrchestrator(input: {
  from: string;
  pushName?: string;
  body: string;
  providerMessageId: string;
  correlationId: string;
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
      payload: { source: 'whatsapp-cloud-api' },
    },
  };

  try {
    const response = await fetch(env.ORCHESTRATOR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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

async function sendWhatsappMessage(to: string, body: string, correlationId: string): Promise<void> {
  const endpoint = `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body,
      },
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`meta_send_status_${response.status}: ${raw}`);
  }

  log('info', 'meta_message_sent', {
    correlationId,
    to,
  });
}

const app = express();

app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

app.get('/ready', (_req, res) => {
  res.status(200).json({
    ready: true,
    provider: 'meta-cloud-api',
    graphVersion: env.META_GRAPH_VERSION,
    phoneNumberId: env.META_PHONE_NUMBER_ID,
  });
});

app.get('/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] ?? '');
  const token = String(req.query['hub.verify_token'] ?? '');
  const challenge = String(req.query['hub.challenge'] ?? '');

  if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN) {
    log('info', 'meta_webhook_verified');
    res.status(200).send(challenge);
    return;
  }

  log('warn', 'meta_webhook_verify_failed', { mode });
  res.status(403).send('forbidden');
});

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const signatureHeader = req.header('x-hub-signature-256');

  if (!verifyMetaSignature(rawBody, signatureHeader)) {
    log('warn', 'meta_signature_invalid');
    res.status(403).send('invalid signature');
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    res.status(400).send('invalid json');
    return;
  }

  const incoming = extractIncomingMessages(payload);
  if (!incoming.length) {
    res.status(200).send('ok');
    return;
  }

  for (const message of incoming) {
    const correlationId = message.providerMessageId || randomUUID();
    if (isDuplicate(message.providerMessageId)) {
      log('debug', 'duplicate_message_ignored', {
        from: message.from,
        providerMessageId: message.providerMessageId,
        correlationId,
      });
      continue;
    }

    const startedAt = Date.now();
    log('info', 'incoming_message', {
      from: message.from,
      providerMessageId: message.providerMessageId,
      correlationId,
      text: truncateText(message.text),
    });

    try {
      const orchestratorRes = await callOrchestrator({
        from: message.from,
        pushName: message.pushName,
        body: message.text,
        providerMessageId: message.providerMessageId,
        correlationId,
      });

      const reply = extractReplyText(orchestratorRes);
      await sendWhatsappMessage(message.from, reply, correlationId);

      const orchestrationCorrelationId = orchestratorRes.correlationId
        ?? orchestratorRes.responses?.[0]?.payload?.correlationId;

      log('info', 'orchestrator_replied', {
        from: message.from,
        providerMessageId: message.providerMessageId,
        correlationId,
        orchestrationCorrelationId,
        status: 'ok',
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      log('error', 'message_processing_failed', {
        from: message.from,
        providerMessageId: message.providerMessageId,
        correlationId,
        status: 'error',
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  res.status(200).send('ok');
});

app.listen(env.PORT, () => {
  log('info', 'http_server_started', {
    port: env.PORT,
    provider: 'meta-cloud-api',
    graphVersion: env.META_GRAPH_VERSION,
    phoneNumberId: env.META_PHONE_NUMBER_ID,
  });
});
