/**
 * Upstream @stellar/mpp Charge server (not a Nirium x402Serve).
 * Listens on 127.0.0.1 and charges CHARGE_AMOUNT testnet USDC per request.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Mppx, stellar, Store } from '@stellar/mpp/charge/server';
import { USDC_SAC_TESTNET } from '@stellar/mpp';
import { chargeAmount, chargePort, loadExampleEnv, mppServerSecret, sellerPublicKey } from './env.js';

export type ChargeServerOptions = {
  recipient: string;
  port?: number;
  amount?: string;
  mppSecretKey?: string;
};

export async function startChargeServer(options: ChargeServerOptions): Promise<Server> {
  const port = options.port ?? 3403;
  const amount = options.amount ?? '0.01';
  const recipient = options.recipient;

  const mppx = Mppx.create({
    secretKey: options.mppSecretKey ?? mppServerSecret(),
    methods: [
      stellar.charge({
        recipient,
        currency: USDC_SAC_TESTNET,
        network: 'stellar:testnet',
        store: Store.memory(),
      }),
    ],
  });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, recipient, amount }));
        return;
      }
      const webReq = new Request(url, { method: req.method, headers: headersFromNode(req.headers) });
      const result = await mppx.charge({ amount, description: 'Nirium #349 testnet charge' })(webReq);
      if (result.status === 402) {
        const challenge = result.challenge;
        res.writeHead(challenge.status, Object.fromEntries(challenge.headers));
        res.end(await challenge.text());
        return;
      }
      const receipt = result.withReceipt(
        Response.json({
          ok: true,
          message: 'Payment verified — paid content from the upstream Charge server.',
          amount,
          recipient,
        }),
      );
      res.writeHead(receipt.status, Object.fromEntries(receipt.headers));
      res.end(await receipt.text());
    } catch (err) {
      const message = sanitize(err instanceof Error ? err.message : String(err));
      console.error('server error:', message);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return server;
}

function headersFromNode(headers: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) out.append(key, item);
    } else {
      out.set(key, value);
    }
  }
  return out;
}

/** Strip Stellar secret seeds from log/error text (gitleaks: S[A-Z2-7]{55}). */
function sanitize(text: string): string {
  return text.replace(/\bS[A-Z2-7]{55}\b/g, '[redacted-secret]');
}

async function main(): Promise<void> {
  loadExampleEnv();
  const recipient = sellerPublicKey();
  const port = chargePort();
  const amount = chargeAmount();
  await startChargeServer({ recipient, port, amount });
  console.log(`MPP Charge server on http://127.0.0.1:${port}  recipient ${recipient}  amount ${amount}`);
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entry) {
  main().catch((err) => {
    console.error(sanitize(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  });
}
