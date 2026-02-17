import { env } from '../config';

export interface RagCitation {
  source?: string;
  chunkIndex?: number;
}

export interface RagUsedChunk {
  source?: string;
  chunkIndex?: number;
  score?: number;
  title?: string;
}

export interface RagAnswerResult {
  answer: string;
  citations: RagCitation[];
  usedChunks: RagUsedChunk[];
  status?: 'ok' | 'low_confidence' | 'no_context';
  confidenceScore?: number;
  bestScore?: number | null;
  statusCode: number;
  latencyMs: number;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT']);

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = String((error as { code?: unknown }).code ?? '');
  if (RETRYABLE_ERROR_CODES.has(code)) return true;
  return error.name === 'AbortError';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePayload(raw: unknown): {
  answer: string;
  citations: RagCitation[];
  usedChunks: RagUsedChunk[];
  status?: 'ok' | 'low_confidence' | 'no_context';
  confidenceScore?: number;
  bestScore?: number | null;
} {
  const parsed = raw as {
    data?: {
      answer?: string;
      citations?: RagCitation[];
      usedChunks?: RagUsedChunk[];
      status?: 'ok' | 'low_confidence' | 'no_context';
      confidenceScore?: number;
      bestScore?: number | null;
    };
    answer?: string;
    citations?: RagCitation[];
    usedChunks?: RagUsedChunk[];
    status?: 'ok' | 'low_confidence' | 'no_context';
    confidenceScore?: number;
    bestScore?: number | null;
  };

  const payload = parsed.data ?? parsed;
  return {
    answer: String(payload.answer ?? '').trim(),
    citations: Array.isArray(payload.citations) ? payload.citations : [],
    usedChunks: Array.isArray(payload.usedChunks) ? payload.usedChunks : [],
    status: payload.status,
    confidenceScore: typeof payload.confidenceScore === 'number' ? payload.confidenceScore : undefined,
    bestScore: typeof payload.bestScore === 'number' || payload.bestScore === null ? payload.bestScore : undefined,
  };
}

async function executeRagRequest(query: string, correlationId: string): Promise<RagAnswerResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ORCH_RAG_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.ORCH_RAG_BASE_URL}${env.ORCH_RAG_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-correlation-id': correlationId,
        'x-request-id': correlationId,
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    const textBody = await response.text();
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const error = new Error(`RAG_STATUS_${response.status}: ${textBody.slice(0, 300)}`);
      (error as { status?: number }).status = response.status;
      throw error;
    }

    let parsedBody: unknown = {};
    try {
      parsedBody = JSON.parse(textBody);
    } catch {
      parsedBody = {};
    }

    const payload = parsePayload(parsedBody);
    return {
      ...payload,
      statusCode: response.status,
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function askRag(query: string, correlationId: string): Promise<RagAnswerResult> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < 2) {
    attempt += 1;
    try {
      return await executeRagRequest(query, correlationId);
    } catch (error) {
      lastError = error;
      const status = Number((error as { status?: number }).status ?? 0);
      const retryable = RETRYABLE_STATUS.has(status) || isRetryableError(error);
      if (!retryable || attempt >= 2) break;
      await sleep(250 * attempt);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`RAG_REQUEST_FAILED: ${message}`);
}
