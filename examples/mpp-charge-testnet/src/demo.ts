/**
 * One command: start the upstream Charge server and make a single paid
 * request with nirium initMpp() on stellar:testnet.
 */
import { Agent } from 'nirium';
import { chargeAmount, chargePort, loadExampleEnv, payerSecretKey, sellerPublicKey } from './env.js';
import { startChargeServer } from './server.js';

const PAID_PATH = '/resource';

/** Strip Stellar secret seeds from log/error text (gitleaks: S[A-Z2-7]{55}). */
function sanitize(text: string): string {
  return text.replace(/\bS[A-Z2-7]{55}\b/g, '[redacted-secret]');
}

function isXdrV1Error(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('toEnvelope') && message.includes('.v1 is not a function');
}

function receiptReference(headers: Headers): string | undefined {
  const raw = headers.get('PAYMENT-RECEIPT') ?? headers.get('payment-receipt');
  if (!raw) return undefined;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { reference?: string; payload?: { reference?: string } };
    return parsed.reference ?? parsed.payload?.reference;
  } catch {
    return undefined;
  }
}

async function waitForHealth(url: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Charge server did not become ready at ${url}`);
}

async function main(): Promise<void> {
  loadExampleEnv();
  const recipient = sellerPublicKey();
  const secretKey = payerSecretKey();
  const port = chargePort();
  const amount = chargeAmount();
  const paidUrl = `http://127.0.0.1:${port}${PAID_PATH}`;

  const server = await startChargeServer({ recipient, port, amount });
  try {
    await waitForHealth(`http://127.0.0.1:${port}/health`);
    console.log(`MPP Charge server on http://127.0.0.1:${port}  recipient ${recipient}  amount ${amount}`);

    const agent = new Agent({ apiKey: 'unused-mpp-only' });
    agent.initMpp({ secretKey, network: 'stellar:testnet', mode: 'pull' });
    console.log('client: nirium initMpp (pull) against', paidUrl);

    const response = await agent.mppFetch(paidUrl);
    const body = await response.text();
    const reference = receiptReference(response.headers);
    console.log('HTTP', response.status);
    if (reference) console.log('settlement', reference);
    console.log('body', sanitize(body).slice(0, 800));
    if (!response.ok) process.exitCode = 1;
  } catch (err) {
    const message = sanitize(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    if (isXdrV1Error(err)) {
      console.error('FAILED', message);
      console.error(
        'This is the known @stellar/mpp@0.7.1 break on stellar-sdk 17: prepared.toEnvelope(...).v1 is not a function.',
      );
      console.error(
        'A successful payment needs @stellar/mpp built from stellar-mpp-sdk main (see README) until stellar/stellar-mpp-sdk#108 publishes.',
      );
    } else {
      console.error('FAILED', message);
    }
    if (err instanceof Error && err.stack) {
      console.error(
        sanitize(err.stack)
          .split('\n')
          .slice(0, 20)
          .join('\n'),
      );
    }
    process.exitCode = 1;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main();
