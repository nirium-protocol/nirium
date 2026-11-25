import 'dotenv/config';
import { createNiriumPayer } from './nirium-payer.ts';
import { createNiriumPayTool } from './nirium-tool.ts';

/** Calls only the over-cap route, so the refusal can be shown without paying. */
const secretKey = process.env.STELLAR_SECRET_KEY;
if (!secretKey) {
    throw new Error('Set STELLAR_SECRET_KEY to your own funded stellar:testnet secret key (S...). Never commit it.');
}

const base = process.env.NIRIUM_X402_BASE ?? 'http://127.0.0.1:3404';
const cap = process.env.NIRIUM_X402_CAP ?? '$0.05';
const payer = createNiriumPayer({ secretKey, network: 'stellar:testnet', maxAmountPerPayment: cap });
const payTool = createNiriumPayTool({ payer });

const result = await payTool.execute!({ url: `${base}/premium/report` });
console.log(JSON.stringify(result, null, 2));
