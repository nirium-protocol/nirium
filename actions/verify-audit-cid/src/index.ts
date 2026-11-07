import fs from 'node:fs/promises';
import { fetchAndVerifyCid, type SignatureStatus, type VerifyResult } from './verify.js';

function envInputName(name: string): string {
  return `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
}

function getInput(name: string, required = false): string {
  const primary = envInputName(name);
  const fallback = primary.replace(/-/g, '_');
  const value = process.env[primary] ?? process.env[fallback] ?? '';
  const trimmed = value.trim();
  if (required && !trimmed) {
    throw new Error(`Input required and not supplied: ${name}`);
  }
  return trimmed;
}

function escapeCommandValue(value: string): string {
  return value
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function info(message: string): void {
  console.log(message);
}

function warning(message: string): void {
  console.warn(`::warning::${escapeCommandValue(message)}`);
}

function setFailed(message: string): void {
  console.error(`::error::${escapeCommandValue(message)}`);
  process.exitCode = 1;
}

function parseBooleanInput(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === '' || normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function boolOutput(value: boolean): string {
  return value ? 'true' : 'false';
}

function statusLabel(status: SignatureStatus): string {
  if (status === 'valid') return 'valid';
  if (status === 'invalid') return 'invalid';
  return 'absent';
}

function verificationMessage(result: VerifyResult): string {
  if (result.error) return result.error;
  if (!result.hashMatch) {
    return `Audit record hash mismatch: expected ${result.expectedHash}, computed ${result.computedHash}`;
  }
  if (result.signatureStatus === 'invalid') {
    return `Invalid Ed25519 signature for signer ${result.signerKey || 'unknown'}`;
  }
  return result.ok ? 'Verification passed' : 'Verification failed';
}

async function appendFileIfConfigured(envName: string, body: string): Promise<boolean> {
  const filePath = process.env[envName];
  if (!filePath) return false;
  await fs.appendFile(filePath, body, 'utf8');
  return true;
}

async function setOutput(name: string, value: string): Promise<void> {
  const delimiter = `nirium_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const output = `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
  const wroteFile = await appendFileIfConfigured('GITHUB_OUTPUT', output);
  if (!wroteFile) {
    console.log(`::set-output name=${name}::${escapeCommandValue(value)}`);
  }
}

async function setOutputs(result: VerifyResult): Promise<void> {
  await Promise.all([
    setOutput('verified', boolOutput(result.ok)),
    setOutput('hash_match', boolOutput(result.hashMatch)),
    setOutput('signature_valid', statusLabel(result.signatureStatus)),
    setOutput('signer', result.signerKey || ''),
    setOutput('content_sha256', result.computedHash),
    setOutput('cid', result.cid || ''),
    setOutput('gateway', result.gateway || ''),
    setOutput('error', result.error || ''),
  ]);
}

function tableEscape(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function renderSummary(result: VerifyResult): string {
  const rows = [
    ['CID', result.cid || ''],
    ['Gateway', result.gateway || ''],
    ['Fetch URL', result.url || ''],
    ['Verified', boolOutput(result.ok)],
    ['Hash match', boolOutput(result.hashMatch)],
    ['Recomputed SHA-256', result.computedHash || ''],
    ['Declared SHA-256', result.expectedHash || ''],
    ['Agent signer', result.signerKey || 'N/A'],
    ['Signature status', statusLabel(result.signatureStatus)],
    ['Agent id', result.agentId || 'N/A'],
  ];

  return [
    '## Nirium Audit CID Verification',
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...rows.map(([field, value]) => `| ${tableEscape(field)} | ${tableEscape(value)} |`),
    '',
    verificationMessage(result),
    '',
  ].join('\n');
}

async function writeSummary(result: VerifyResult): Promise<void> {
  const summary = renderSummary(result);
  const wroteFile = await appendFileIfConfigured('GITHUB_STEP_SUMMARY', summary);
  if (!wroteFile) {
    console.log(summary);
  }
}

export async function run(): Promise<void> {
  const cid = getInput('cid', true);
  const gateway = getInput('gateway');
  const gatewaysRaw = getInput('gateways');
  const gateways = gatewaysRaw
    ? gatewaysRaw
        .split(/[,\n]/)
        .map((g) => g.trim())
        .filter(Boolean)
    : undefined;
  const failOnError = parseBooleanInput(getInput('fail-on-error') || 'true');

  const result = await fetchAndVerifyCid(cid, {
    gateway: gateway || undefined,
    gateways,
  });
  await setOutputs(result);
  await writeSummary(result);

  const message = verificationMessage(result);
  if (!result.ok) {
    if (failOnError) {
      setFailed(message);
    } else {
      warning(message);
    }
    return;
  }

  info(message);
}

run().catch((err: unknown) => {
  setFailed(err instanceof Error ? err.message : String(err));
});
