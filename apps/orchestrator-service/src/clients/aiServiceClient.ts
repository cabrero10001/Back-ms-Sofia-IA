import { env } from '../config';

export type AIResult = {
  intent: string;
  confidence?: number;
  entities?: any;
  shouldReset?: boolean;
};

export async function classifyExtract(text: string): Promise<AIResult> {
  const response = await fetch(`${env.AI_SERVICE_URL}/v1/ai/classify-extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI service responded ${response.status}: ${errorText}`);
  }

  const json = (await response.json()) as { data?: AIResult } | AIResult;
  const payload = (json as { data?: AIResult }).data ?? (json as AIResult);

  return payload;
}
