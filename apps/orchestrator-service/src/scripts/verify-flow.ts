import { __testOnly_runStatefulFlow } from '../services/orchestrator.service';
import { MessageIn } from '../dtos';

function buildMessage(externalUserId: string, text: string): MessageIn {
  return {
    tenantId: 'tenant_test',
    channel: 'webchat',
    externalUserId,
    message: {
      type: 'text',
      message: text,
    } as any,
  };
}

async function run(): Promise<void> {
  const user = `verify-${Date.now()}`;

  const hello = await __testOnly_runStatefulFlow({
    messageIn: buildMessage(user, 'Hola'),
    conversationId: 'conv-1',
    correlationId: 'corr-1',
  });

  const laboral = await __testOnly_runStatefulFlow({
    messageIn: buildMessage(user, 'laboral'),
    conversationId: 'conv-1',
    correlationId: 'corr-2',
  });

  const user2 = `verify-${Date.now()}-support`;
  await __testOnly_runStatefulFlow({
    messageIn: buildMessage(user2, 'Hola'),
    conversationId: 'conv-2',
    correlationId: 'corr-3',
  });
  const soporte = await __testOnly_runStatefulFlow({
    messageIn: buildMessage(user2, 'soporte'),
    conversationId: 'conv-2',
    correlationId: 'corr-4',
  });

  console.log('Hola ->', hello.responseText);
  console.log('laboral ->', laboral.responseText, laboral.patch);
  console.log('soporte ->', soporte.responseText, soporte.patch);
}

run().catch((error) => {
  console.error('verify-flow failed', error);
  process.exit(1);
});
