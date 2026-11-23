import 'dotenv/config';
import { Agent } from '@mastra/core/agent';
import { createNiriumPayer } from './nirium-payer.ts';
import { createNiriumPayTool } from './nirium-tool.ts';

const secretKey = process.env.STELLAR_SECRET_KEY;
if (!secretKey) {
    throw new Error('Set STELLAR_SECRET_KEY to your own funded stellar:testnet secret key (S...). Never commit it.');
}

const cap = process.env.NIRIUM_X402_CAP ?? '$0.05';
const target = process.env.NIRIUM_X402_TARGET ?? 'http://127.0.0.1:3404/premium/signals';

const payer = createNiriumPayer({ secretKey, network: 'stellar:testnet', maxAmountPerPayment: cap });
const payTool = createNiriumPayTool({ payer });

export const agent = new Agent({
    id: 'nirium-payer',
    name: 'Nirium payer',
    instructions: `You buy data from x402 endpoints with the pay_x402_endpoint tool. `
        + `The wallet caps every payment at ${cap}; never ask for a higher cap. `
        + 'If a payment is refused, report the amount the server asked for and the cap, '
        + 'then stop. Do not retry the same URL.',
    model: process.env.MASTRA_MODEL ?? 'openai/gpt-5-mini',
    tools: { payTool },
});

if (import.meta.url === `file://${process.argv[1]}`) {
    const prompt = process.argv[2] ?? `Buy ${target} and summarise what it returned.`;
    const result = await agent.generate(prompt);
    console.log(result.text);
}
