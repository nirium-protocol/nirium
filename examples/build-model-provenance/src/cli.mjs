#!/usr/bin/env node
// Usage: node src/cli.mjs <keygen|demo-data|record|anchor|check-model> [options]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Keypair } from '@stellar/stellar-sdk';
import {
  anchorRecord, buildRecord, buildTag, checkModel, gitCommit, recordBytes, signerFromSecret, DEFAULT_URL,
} from './provenance.mjs';

const DIR = '.provenance';
const die = (msg) => { console.error(`error: ${msg}`); process.exit(1); };
const [cmd, ...rest] = process.argv.slice(2);

function opts(options) {
  return parseArgs({ args: rest, options, allowPositionals: true }).values;
}
function pos() {
  return parseArgs({ args: rest, options: {}, allowPositionals: true, strict: false }).positionals;
}

// Tiny deterministic "weights": float32 values from a seeded LCG.
function fakeWeights(seed, n = 4096) {
  const buf = Buffer.alloc(n * 4);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    buf.writeFloatLE(s / 2 ** 32 - 0.5, i * 4);
  }
  return buf;
}

async function main() {
  if (cmd === 'keygen') {
    const kp = Keypair.random();
    console.log(`PROVENANCE_SIGNER_SECRET=${kp.secret()}\n# public key: ${kp.publicKey()}\n# Testnet signer only. It signs statements and never needs funds.`);
  } else if (cmd === 'demo-data') {
    fs.mkdirSync('demo', { recursive: true });
    fs.writeFileSync('demo/model-v1.bin', fakeWeights(1));
    fs.writeFileSync('demo/model-v2.bin', fakeWeights(2));
    console.log('wrote demo/model-v1.bin and demo/model-v2.bin (synthetic weights, no real data)');
  } else if (cmd === 'record') {
    const o = opts({
      kind: { type: 'string', default: 'model' }, name: { type: 'string' }, version: { type: 'string' },
      config: { type: 'string' }, 'data-source': { type: 'string', multiple: true },
      'code-commit': { type: 'string' }, out: { type: 'string' },
    });
    const [artifact] = pos();
    if (!artifact) die('usage: record <artifact> --name <n> --version <v> [--config file.json] [--data-source NAME ...] [--code-commit sha]');
    const config = o.config ? JSON.parse(fs.readFileSync(o.config, 'utf8')) : {};
    const record = buildRecord({
      artifactPath: artifact, kind: o.kind, name: o.name, version: o.version, config,
      dataSources: o['data-source'] ?? [], codeCommit: o['code-commit'] ?? gitCommit(),
    });
    const out = o.out ?? path.join(DIR, `${record.name}-${record.version}.record.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, recordBytes(record), { mode: 0o600 });
    console.log(`private record: ${out}\nartifact sha256: ${record.artifact.sha256}`);
  } else if (cmd === 'anchor') {
    const o = opts({ tag: { type: 'string' }, url: { type: 'string', default: process.env.NIRIUM_API_URL ?? DEFAULT_URL }, out: { type: 'string' } });
    const [recordPath] = pos();
    if (!recordPath) die('usage: anchor <record.json> [--tag wave11-...]');
    const buf = fs.readFileSync(recordPath);
    const record = JSON.parse(buf.toString('utf8'));
    const keypair = signerFromSecret(process.env.PROVENANCE_SIGNER_SECRET);
    const receipt = await anchorRecord(buf, { keypair, tag: buildTag(record, o.tag), url: o.url });
    const out = o.out ?? recordPath.replace(/\.record\.json$/, '') + '.receipt.json';
    fs.writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n');
    console.log(`receipt: ${out}\ncid: ${receipt.cid}\nsha256: ${receipt.sha256}\nverify: npx nirium-cli verify ${receipt.cid} --hash ${receipt.sha256}`);
  } else if (cmd === 'check-model') {
    const o = opts({ record: { type: 'string' }, receipt: { type: 'string' }, offline: { type: 'boolean', default: false } });
    const [artifact] = pos();
    if (!artifact || !o.record || !o.receipt) die('usage: check-model <artifact> --record <record.json> --receipt <receipt.json> [--offline]');
    const receipt = JSON.parse(fs.readFileSync(o.receipt, 'utf8'));
    const verifyReceipt = o.offline ? () => ({ ok: true, result: null }) : undefined;
    const { ok, steps } = checkModel({ artifactPath: artifact, recordBuf: fs.readFileSync(o.record), receipt, ...(verifyReceipt && { verifyReceipt }) });
    for (const s of steps) console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}${s.detail ? `  (${s.detail})` : ''}`);
    console.log(ok ? '\nOK: these weights are the ones the receipt covers' : '\nFAILED: these weights are NOT covered by the receipt');
    process.exit(ok ? 0 : 1);
  } else {
    die('commands: keygen | demo-data | record | anchor | check-model');
  }
}

main().catch((e) => die(e.message));
