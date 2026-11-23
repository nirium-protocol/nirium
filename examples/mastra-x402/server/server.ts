import 'dotenv/config';
import express from 'express';
import { x402Serve } from 'nirium';

const port = Number(process.env.PORT ?? 3404);
const payTo = process.env.NIRIUM_X402_PAY_TO;
const facilitatorApiKey = process.env.NIRIUM_X402_FACILITATOR_API_KEY;

if (!payTo) {
    throw new Error('Set NIRIUM_X402_PAY_TO to your own Stellar testnet address (G...). Payments go to it, not to Nirium.');
}

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'nirium-mastra-x402-seller', network: 'stellar:testnet', payTo });
});

app.use(x402Serve({
    payTo,
    network: 'stellar:testnet',
    facilitatorApiKey,
    appName: 'Nirium Mastra x402 example',
    routes: {
        'GET /premium/signals': '$0.02',
        // Deliberately above the example cap, so the refusal path can be demoed
        // against the same seller.
        'GET /premium/report': '$2.00',
    },
}));

app.get('/premium/signals', (_req, res) => {
    res.json({
        ok: true,
        route: '/premium/signals',
        price: '0.02 USDC',
        signals: [{ pair: 'XLM/USDC', confidence: 0.71, note: 'example payload, not financial advice' }],
    });
});

app.get('/premium/report', (_req, res) => {
    res.json({ ok: true, route: '/premium/report', price: '2.00 USDC', report: 'example payload' });
});

app.listen(port, () => {
    console.log(`Seller on http://127.0.0.1:${port}`);
    console.log(`  GET /premium/signals  $0.02`);
    console.log(`  GET /premium/report   $2.00`);
    console.log(`payTo ${payTo} on stellar:testnet`);
});
