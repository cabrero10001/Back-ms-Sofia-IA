import { randomUUID } from 'crypto';

type MessageVariant = {
  name: string;
  payloadFactory: (text: string) => Record<string, unknown>;
};

type OrchestratorApiResponse = {
  data?: {
    conversationId?: string;
    contactId?: string;
    correlationId?: string;
    responses?: Array<{
      text?: string;
      payload?: {
        debug?: {
          extractedText?: string;
        extractedRawText?: string;
        category?: string | null;
        intentBefore?: string | null;
        intentAfter?: string | null;
          stepBefore?: string | null;
          stepAfter?: string | null;
        };
      };
    }>;
  };
};

const baseUrl = process.env.ORCH_BASE_URL ?? 'http://127.0.0.1:3022';
const endpoint = `${baseUrl}/v1/orchestrator/handle-message`;

async function sendMessage(body: Record<string, unknown>): Promise<OrchestratorApiResponse['data']> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-correlation-id': `verify-${randomUUID()}`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const parsed = JSON.parse(text) as OrchestratorApiResponse;
  return parsed.data;
}

function baseEnvelope(userId: string): Record<string, unknown> {
  return {
    tenantId: 'tenant_ai_demo',
    channel: 'webchat',
    externalUserId: userId,
  };
}

function getReplyText(data: OrchestratorApiResponse['data']): string {
  return String(data?.responses?.[0]?.text ?? '');
}

function getDebug(data: OrchestratorApiResponse['data']) {
  return data?.responses?.[0]?.payload?.debug;
}

function assertCondition(condition: boolean, error: string): void {
  if (!condition) throw new Error(error);
}

function printTrace(label: string, data: OrchestratorApiResponse['data']): void {
  const debug = getDebug(data);
  console.log(`\n[${label}]`);
  console.log(`conversationId: ${data?.conversationId}`);
  console.log(`correlationId: ${data?.correlationId}`);
  console.log(`extractedText: ${debug?.extractedText}`);
  console.log(`category: ${debug?.category}`);
  console.log(`stepBefore -> stepAfter: ${debug?.stepBefore} -> ${debug?.stepAfter}`);
  console.log(`intentBefore -> intentAfter: ${debug?.intentBefore} -> ${debug?.intentAfter}`);
  console.log(`reply: ${getReplyText(data)}`);
}

async function runCoreFlowChecks(): Promise<void> {
  const user = `verify-core-${Date.now()}`;

  const hola = await sendMessage({
    ...baseEnvelope(user),
    message: { type: 'text', text: 'Hola' },
  });
  printTrace('hola', hola);
  assertCondition(getReplyText(hola).toLowerCase().includes('laboral'), 'Hola no devolvio menu laboral/soporte');

  const laboral = await sendMessage({
    ...baseEnvelope(user),
    message: { type: 'text', message: 'laboral' },
  });
  printTrace('laboral', laboral);
  assertCondition(!getReplyText(laboral).toLowerCase().includes('hola 👋 ¿en qué te ayudo'), 'laboral quedo en menu');
  assertCondition(
    getReplyText(laboral).toLowerCase().includes('consulta laboral') || getReplyText(laboral).toLowerCase().includes('escribe tu consulta'),
    'laboral no paso al siguiente step',
  );

  const soporteUser = `verify-support-${Date.now()}`;
  await sendMessage({
    ...baseEnvelope(soporteUser),
    message: { type: 'text', text: 'Hola' },
  });

  const soporte = await sendMessage({
    ...baseEnvelope(soporteUser),
    message: { type: 'text', text: 'soporte' },
  });
  printTrace('soporte', soporte);
  assertCondition(getReplyText(soporte).toLowerCase().includes('describe tu problema'), 'soporte no cambio a collecting_issue');

  const reset = await sendMessage({
    ...baseEnvelope(user),
    message: { type: 'text', text: 'reset' },
  });
  printTrace('reset', reset);
  assertCondition(getReplyText(reset).toLowerCase().includes('laboral'), 'reset no reinicio menu');
}

async function runPayloadMatrix(): Promise<void> {
  const variants: MessageVariant[] = [
    {
      name: 'message(string)',
      payloadFactory: (text: string) => ({ message: text }),
    },
    {
      name: 'root.text',
      payloadFactory: (text: string) => ({ text, message: { type: 'text' } }),
    },
    {
      name: 'message.message',
      payloadFactory: (text: string) => ({ message: { type: 'text', message: text } }),
    },
    {
      name: 'message.text',
      payloadFactory: (text: string) => ({ message: { type: 'text', text } }),
    },
    {
      name: 'message.body',
      payloadFactory: (text: string) => ({ message: { type: 'text', body: text } }),
    },
    {
      name: 'message.text.body',
      payloadFactory: (text: string) => ({ message: { type: 'text', text: { body: text } } }),
    },
  ];

  for (const variant of variants) {
    const user = `verify-matrix-${variant.name}-${Date.now()}`;

    await sendMessage({
      ...baseEnvelope(user),
      message: { type: 'text', text: 'Hola' },
    });

    const payload = {
      ...baseEnvelope(user),
      ...variant.payloadFactory('laboral'),
    };

    const response = await sendMessage(payload);
    printTrace(`matrix:${variant.name}`, response);

    const reply = getReplyText(response).toLowerCase();
    assertCondition(!reply.includes('hola 👋 ¿en qué te ayudo'), `variant ${variant.name} quedo en menu`);
    assertCondition(
      reply.includes('consulta laboral') || reply.includes('escribe tu consulta') || reply.includes('no encontré'),
      `variant ${variant.name} no enruto a laboral`,
    );
  }
}

async function main(): Promise<void> {
  console.log(`Running verify-input against ${endpoint}`);
  await runCoreFlowChecks();
  await runPayloadMatrix();
  console.log('\nPASS: all flow and payload-variant checks succeeded');
}

main().catch((error) => {
  console.error('\nFAIL:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
