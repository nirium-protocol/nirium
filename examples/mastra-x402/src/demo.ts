import 'dotenv/config';
import { createNiriumPayer } from './nirium-payer.ts';
import { createNiriumPayTool } from './nirium-tool.ts';

/**
 * Calls the tool directly, with no LLM, so both outcomes are easy to record:
 * a $0.02 call that pays and a $2.00 call that the cap refuses before signing.
 * Needs the seller from `npm run server` and a funded testnet key.
 */
const secretKey = process.env.STELLAR_SECRET_KEY;
if (!secretKey) {
    throw new Error('Set STELLAR_SECRET_KEY to your own funded stellar:testnet secret key (S...). Never commit it.');
}

const base = process.env.NIRIUM_X402_BASE ?? 'http://127.0.0.1:3404';
const cap = process.env.NIRIUM_X402_CAP ?? '$0.05';
const payer = createNiriumPayer({ secretKey, network: 'stellar:testnet', maxAmountPerPayment: cap });
const payTool = createNiriumPayTool({ payer });

try {
    const paid = await payTool.execute!({ url: `${base}/premium/signals` });
    console.log('paid call:', JSON.stringify(paid, null, 2));
} catch (error) {
    console.error('paid call failed:', error);
}

const refused = await payTool.execute!({ url: `${base}/premium/report` });
console.log('refused call:', JSON.stringify(refused, null, 2));
