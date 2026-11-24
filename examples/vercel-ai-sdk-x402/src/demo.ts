import dotenv from 'dotenv';
import { generateText, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { Agent } from 'nirium';

import { createScriptedModel } from './scripted-model.js';
import { createX402PaidFetchTool, type PaidFetchResult } from './x402-tool.js';

dotenv.config({ quiet: true });

const cheapUrl = process.env.PAID_ENDPOINT ?? 'http://localhost:3402/paid/market-summary';
const expensiveUrl = process.env.EXPENSIVE_ENDPOINT ?? 'http://localhost:3402/paid/full-report';
const maxAmountPerPayment = process.env.MAX_AMOUNT_PER_PAYMENT ?? '$1';
const secretKey = process.env.STELLAR_SECRET_KEY ?? '';

if (!secretKey) {
  console.error('STELLAR_SECRET_KEY is missing. Copy .env.example to .env and use your own testnet key.');
  process.exit(1);
}

const agent = new Agent({ apiKey: 'unused-x402-only' });
agent.initX402({
  secretKey,
  network: 'stellar:testnet',
  maxAmountPerPayment,
});

const payForUrl = createX402PaidFetchTool({
  x402Fetch: (url, init) => agent.x402Fetch(url, init),
  maxAmountPerPayment,
});

const useRealModel = Boolean(process.env.OPENAI_API_KEY);
const model = useRealModel
  ? openai(process.env.OPENAI_MODEL ?? 'gpt-4o-mini')
  : createScriptedModel({ cheapUrl, expensiveUrl });

console.log(`model: ${useRealModel ? 'OpenAI' : 'scripted (no OPENAI_API_KEY)'}`);
console.log(`cap: ${maxAmountPerPayment}`);
console.log(`cheap: ${cheapUrl}`);
console.log(`expensive: ${expensiveUrl}\n`);

const result = await generateText({
  model,
  tools: { payForUrl },
  stopWhen: stepCountIs(4),
  prompt:
    'Use the payForUrl tool twice, in this order: '
    + `(1) ${cheapUrl} and (2) ${expensiveUrl}. `
    + 'Then report the settlement transaction hash of the first call and whether the second was refused, with the reason.',
});

const toolResults: PaidFetchResult[] = [];
for (const [index, step] of result.steps.entries()) {
  for (const call of step.toolCalls) {
    console.log(`step ${index + 1} tool call: ${call.toolName} ${JSON.stringify(call.input)}`);
  }
  for (const toolResult of step.toolResults) {
    const value = toolResult.output as PaidFetchResult;
    toolResults.push(value);
    console.log(`step ${index + 1} tool result: ${JSON.stringify(value, null, 2)}`);
  }
  if (step.text) console.log(`step ${index + 1} text: ${step.text}`);
}

const paid = toolResults.find((r) => r.ok);
const refused = toolResults.find((r) => r.refused);

console.log('\n--- summary ---');
console.log(paid?.settlementTx
  ? `paid: ${paid.url} (tx ${paid.settlementTx})`
  : 'paid: no settlement transaction was reported');
console.log(refused
  ? `refused before signing: ${refused.url}\n  ${refused.reason}`
  : 'refused before signing: no refusal was reported');

if (toolResults.length === 0) {
  console.error('The model did not call the tool.');
  process.exit(1);
}
