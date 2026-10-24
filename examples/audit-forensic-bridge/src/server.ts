import express from 'express';
import { Agent } from 'nirium';
import { signAuditRecord } from './attestation.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;
const AGENT_SECRET = process.env.STELLAR_SECRET_KEY;
const NIRIUM_API_KEY = process.env.NIRIUM_API_KEY || 'nrm_test_key';
const NIRIUM_BASE_URL = process.env.NIRIUM_BASE_URL || 'http://localhost:3002';

const agentClient = new Agent({
  apiKey: NIRIUM_API_KEY,
  baseUrl: NIRIUM_BASE_URL,
});

app.post('/webhook', async (req, res) => {
  const event = req.body;
  if (!event || typeof event !== 'object') {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  try {
    let agentAttestation = undefined;
    if (AGENT_SECRET) {
      const attestation = signAuditRecord(event, AGENT_SECRET);
      agentAttestation = {
        key: attestation.publicKey,
        signature: attestation.signature,
        id: 'forensic-bridge-agent',
      };
    }

    const anchor = await agentClient.anchorAuditRecord({
      record: event,
      tag: 'webhook-event',
      agent: agentAttestation,
    });

    return res.status(200).json({
      status: 'anchored',
      cid: anchor.cid,
      contentSha256: anchor.contentSha256,
      attestedBy: anchor.attestedBy,
    });
  } catch (error: any) {
    console.error('Failed to anchor event:', error);
    return res.status(500).json({ error: error.message || 'Anchoring failed' });
  }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[Forensic Bridge] Listening on http://localhost:${PORT}/webhook`);
  });
}

export { app };