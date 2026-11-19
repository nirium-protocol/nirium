import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@stellar/stellar-sdk';
import { Agent } from 'nirium';
import {
  type Announcement,
  escapeHtml,
  parseAnnouncement,
  renderAnnouncementBody,
} from './announcement.js';

export const DEFAULT_NIRIUM_URL = 'https://nirium-agent.fly.dev';
export const DEFAULT_TAG = 'wave11-tamper-evident-announcements';
export const MANIFEST_SCHEMA = 'nirium.announcements.v1';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CID_PATTERN = /^[A-Za-z0-9]{20,128}$/;
const TAG_PATTERN = /^wave11-[a-z0-9-]+$/;

export interface Publication {
  file: string;
  sha256: string;
  cid: string;
  anchoredAt: string;
  signer: string;
  tag: string;
}

export interface PublicationManifest {
  schema: typeof MANIFEST_SCHEMA;
  announcements: Publication[];
}

export interface BuildSiteOptions {
  rootDir: string;
  signingKey?: string;
  tag?: string;
  baseUrl?: string;
  checkOnly?: boolean;
}

export interface BuildSiteResult {
  siteDir: string;
  announcements: Announcement[];
  publications: Publication[];
  newlyAnchored: string[];
}

export interface AnchorAnnouncementOptions {
  hash: string;
  signingKey: string;
  tag: string;
  baseUrl?: string;
}

export class TamperError extends Error {
  readonly details: readonly string[];

  constructor(details: readonly string[]) {
    super([
      'TAMPER DETECTED: a published announcement no longer matches its receipt.',
      ...details,
      'Refusing to anchor or write the site. Restore the file, or publish the',
      'change as a new announcement with a new filename.',
    ].join('\n'));
    this.name = 'TamperError';
    this.details = details;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function parsePublication(value: unknown, index: number): Publication {
  const item = asObject(value, `publications[${index}]`);
  const fields = ['file', 'sha256', 'cid', 'anchoredAt', 'signer', 'tag'] as const;
  for (const field of fields) {
    if (typeof item[field] !== 'string' || item[field] === '') {
      throw new Error(`publications[${index}].${field} must be a non-empty string`);
    }
  }
  const publication = item as unknown as Publication;
  if (!HASH_PATTERN.test(publication.sha256)) {
    throw new Error(`publications[${index}].sha256 must be 64 lowercase hex characters`);
  }
  if (!CID_PATTERN.test(publication.cid)) {
    throw new Error(`publications[${index}].cid is not a plausible IPFS CID`);
  }
  if (!TAG_PATTERN.test(publication.tag)) {
    throw new Error(`publications[${index}].tag must start with wave11-`);
  }
  return publication;
}

function parseManifest(value: unknown): PublicationManifest {
  const manifest = asObject(value, 'publications.json');
  if (manifest.schema !== MANIFEST_SCHEMA) {
    throw new Error(`publications.json schema must be ${MANIFEST_SCHEMA}`);
  }
  if (!Array.isArray(manifest.announcements)) {
    throw new Error('publications.json announcements must be an array');
  }
  return {
    schema: MANIFEST_SCHEMA,
    announcements: manifest.announcements.map(parsePublication),
  };
}

async function readManifest(rootDir: string): Promise<PublicationManifest> {
  const path = join(rootDir, 'publications.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return { schema: MANIFEST_SCHEMA, announcements: [] };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('publications.json is not valid JSON');
  }
  return parseManifest(parsed);
}

async function writeManifest(rootDir: string, manifest: PublicationManifest): Promise<void> {
  const path = join(rootDir, 'publications.json');
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function readAnnouncements(rootDir: string): Promise<Announcement[]> {
  const directory = join(rootDir, 'announcements');
  const files = (await readdir(directory))
    .filter((file) => file.endsWith('.md'))
    .sort();
  const announcements: Announcement[] = [];
  for (const file of files) {
    announcements.push(parseAnnouncement(file, await readFile(join(directory, file))));
  }
  return announcements.sort(
    (left, right) => right.date.localeCompare(left.date) || left.file.localeCompare(right.file),
  );
}

function assertNoPublishedChanges(
  announcements: readonly Announcement[],
  manifest: PublicationManifest,
): Announcement[] {
  const publications = new Map(
    manifest.announcements.map((publication) => [publication.file, publication]),
  );
  const details: string[] = [];

  for (const announcement of announcements) {
    const publication = publications.get(announcement.file);
    if (!publication) continue;
    if (publication.sha256 !== announcement.sha256) {
      details.push(
        `  ${announcement.file}\n`
        + `    published sha256: ${publication.sha256}\n`
        + `    current sha256:   ${announcement.sha256}`,
      );
    }
    publications.delete(announcement.file);
  }

  for (const missing of publications.values()) {
    details.push(`  ${missing.file}\n    receipt exists but the announcement file is gone`);
  }

  if (details.length > 0) {
    throw new TamperError(details);
  }

  const publishedFiles = new Set(manifest.announcements.map((publication) => publication.file));
  return announcements.filter((announcement) => !publishedFiles.has(announcement.file));
}

export async function anchorAnnouncementHash(
  options: AnchorAnnouncementOptions,
): Promise<Publication> {
  if (!HASH_PATTERN.test(options.hash)) {
    throw new Error('Announcement hash must be 64 lowercase hex characters');
  }
  if (!TAG_PATTERN.test(options.tag)) {
    throw new Error('Announcement tag must start with wave11-');
  }

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(options.signingKey);
  } catch {
    throw new Error('ANNOUNCEMENT_SIGNING_KEY is not a valid Stellar Ed25519 secret key');
  }

  const statement = `nirium-audit-v1:${options.hash}`;
  const signature = Buffer.from(keypair.sign(Buffer.from(statement, 'utf8'))).toString('base64');
  const agent = new Agent({
    apiKey: '',
    baseUrl: options.baseUrl ?? DEFAULT_NIRIUM_URL,
  });
  const anchored = await agent.anchorAuditRecord({
    hash: options.hash,
    tag: options.tag,
    agent: {
      key: keypair.publicKey(),
      signature,
      id: 'nirium-announcements-demo',
    },
  });

  const contentSha256 = typeof anchored.contentSha256 === 'string'
    ? anchored.contentSha256.toLowerCase()
    : '';
  if (contentSha256 !== options.hash) {
    throw new Error(
      `Nirium returned content hash ${contentSha256 || '(missing)'}, expected ${options.hash}`,
    );
  }
  if (typeof anchored.cid !== 'string' || !CID_PATTERN.test(anchored.cid)) {
    throw new Error('Nirium returned an invalid CID');
  }
  if (typeof anchored.anchoredAt !== 'string' || anchored.anchoredAt === '') {
    throw new Error('Nirium did not return anchoredAt');
  }
  if (anchored.attestedBy !== keypair.publicKey()) {
    throw new Error('Nirium did not confirm the signing key on the receipt');
  }

  return {
    file: '',
    sha256: options.hash,
    cid: anchored.cid,
    anchoredAt: anchored.anchoredAt,
    signer: keypair.publicKey(),
    tag: options.tag,
  };
}

function verificationCommand(publication: Publication): string {
  return `npx nirium-cli verify ${publication.cid} --hash ${publication.sha256}`;
}

function evidenceCommand(publication: Publication, announcement: Announcement): string {
  return `npx nirium-cli verify ${publication.cid} --evidence site/announcements/${announcement.file}`;
}

function renderReceipt(publication: Publication, announcement: Announcement): string {
  const verifyUrl = `https://nirium.xyz/verify?cid=${encodeURIComponent(publication.cid)}`;
  return `<section class="receipt">
  <h2>Receipt</h2>
  <dl>
    <dt>CID</dt><dd><code>${escapeHtml(publication.cid)}</code></dd>
    <dt>SHA-256</dt><dd><code>${escapeHtml(publication.sha256)}</code></dd>
    <dt>Signer</dt><dd><code>${escapeHtml(publication.signer)}</code></dd>
    <dt>Anchored at</dt><dd>${escapeHtml(publication.anchoredAt)} <small>(Nirium node clock, not a ledger time)</small></dd>
    <dt>Tag</dt><dd><code>${escapeHtml(publication.tag)}</code></dd>
  </dl>
  <p><a href="${escapeHtml(verifyUrl)}">Verify this CID at nirium.xyz/verify</a></p>
  <pre><code>${escapeHtml(verificationCommand(publication))}</code></pre>
  <p class="muted">Check this page's local copy of the announcement against the receipt:</p>
  <pre><code>${escapeHtml(evidenceCommand(publication, announcement))}</code></pre>
</section>`;
}

const STYLE = `
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { max-width: 52rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; line-height: 1.6; }
  h1 { line-height: 1.2; }
  h2 { margin-top: 2rem; }
  .meta, .muted, small { color: #667085; }
  .card { border: 1px solid #d0d5dd; border-radius: 0.75rem; padding: 1rem 1.25rem; margin: 1.25rem 0; }
  .card h2 { margin-top: 0; }
  .receipt { border: 1px solid #98a2b3; border-radius: 0.75rem; padding: 0.5rem 1.25rem 1rem; margin: 2rem 0; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1rem; }
  dt { font-weight: 600; }
  dd { margin: 0; overflow-wrap: anywhere; }
  code { font-size: 0.9em; overflow-wrap: anywhere; }
  pre { background: #f2f4f7; border-radius: 0.5rem; padding: 0.75rem; overflow-x: auto; }
  @media (prefers-color-scheme: dark) {
    pre { background: #1d2939; }
    .card, .receipt { border-color: #475467; }
  }
`;

function pageHTML(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${STYLE}</style>
</head>
<body>
${content}
<footer class="muted">
  <p>A receipt proves the announcement has not changed since it was anchored
  and who signed it. It does not prove the announcement is true, and
  <code>anchoredAt</code> is the Nirium node's clock, not a ledger time.</p>
  <p>Demo on Stellar testnet. Verify independently at
  <a href="https://nirium.xyz/verify">nirium.xyz/verify</a> or with
  <code>npx nirium-cli verify</code>.</p>
</footer>
</body>
</html>
`;
}

function renderIndex(
  announcements: readonly Announcement[],
  publications: Map<string, Publication>,
): string {
  const cards = announcements.map((announcement) => {
    const publication = publications.get(announcement.file);
    if (!publication) throw new Error(`No receipt for ${announcement.file}`);
    return `<article class="card">
  <p class="meta">${escapeHtml(announcement.date)} · ${escapeHtml(announcement.kind)}</p>
  <h2><a href="announcements/${escapeHtml(announcement.slug)}.html">${escapeHtml(announcement.title)}</a></h2>
  <p>CID <code>${escapeHtml(publication.cid)}</code></p>
  <p>SHA-256 <code>${escapeHtml(publication.sha256)}</code></p>
  <p><a href="https://nirium.xyz/verify?cid=${encodeURIComponent(publication.cid)}">Check this receipt</a></p>
  <pre><code>${escapeHtml(verificationCommand(publication))}</code></pre>
</article>`;
  }).join('\n');

  return pageHTML('Nirium project announcements', `<h1>Nirium project announcements</h1>
<p>Each announcement is published with a SHA-256 hash, a CID and a receipt
signed by the project's Stellar key. A later edit breaks the next build.</p>
${cards}`);
}

function renderAnnouncementPage(
  announcement: Announcement,
  publication: Publication,
): string {
  return pageHTML(
    announcement.title,
    `<p><a href="../index.html">← All announcements</a></p>
<p class="meta">${escapeHtml(announcement.date)} · ${escapeHtml(announcement.kind)}</p>
<h1>${escapeHtml(announcement.title)}</h1>
${renderAnnouncementBody(announcement.body)}
${renderReceipt(publication, announcement)}`,
  );
}

async function writeSite(
  rootDir: string,
  announcements: readonly Announcement[],
  manifest: PublicationManifest,
): Promise<string> {
  const siteDir = join(rootDir, 'site');
  const announcementDir = join(siteDir, 'announcements');
  await mkdir(siteDir, { recursive: true });
  await rm(announcementDir, { recursive: true, force: true });
  await mkdir(announcementDir, { recursive: true });

  const publications = new Map(
    manifest.announcements.map((publication) => [publication.file, publication]),
  );
  for (const announcement of announcements) {
    const publication = publications.get(announcement.file);
    if (!publication) throw new Error(`No receipt for ${announcement.file}`);
    await copyFile(
      join(rootDir, 'announcements', announcement.file),
      join(announcementDir, announcement.file),
    );
    await writeFile(
      join(announcementDir, `${announcement.slug}.html`),
      renderAnnouncementPage(announcement, publication),
      'utf8',
    );
  }

  await writeFile(join(siteDir, 'index.html'), renderIndex(announcements, publications), 'utf8');
  await writeFile(
    join(siteDir, 'publications.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return siteDir;
}

export async function buildSite(options: BuildSiteOptions): Promise<BuildSiteResult> {
  const rootDir = resolve(options.rootDir);
  const tag = options.tag ?? DEFAULT_TAG;
  if (!TAG_PATTERN.test(tag)) {
    throw new Error('Announcement tag must start with wave11-');
  }

  const announcements = await readAnnouncements(rootDir);
  const manifest = await readManifest(rootDir);
  const unpublished = assertNoPublishedChanges(announcements, manifest);

  if (options.checkOnly) {
    if (unpublished.length > 0) {
      throw new Error(
        `${unpublished.length} announcement(s) have no receipt. `
        + 'Run npm run build with ANNOUNCEMENT_SIGNING_KEY to publish them.',
      );
    }
    const publications = [...manifest.announcements].sort(
      (left, right) => left.file.localeCompare(right.file),
    );
    return {
      siteDir: join(rootDir, 'site'),
      announcements,
      publications,
      newlyAnchored: [],
    };
  }

  const newlyAnchored: string[] = [];
  for (const announcement of unpublished) {
    if (!options.signingKey) {
      throw new Error(
        `${announcement.file} has no receipt. Set ANNOUNCEMENT_SIGNING_KEY to a `
        + 'Stellar testnet secret key that you own, then run npm run build.',
      );
    }
    const anchored = await anchorAnnouncementHash({
      hash: announcement.sha256,
      signingKey: options.signingKey,
      tag,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    });
    manifest.announcements.push({ ...anchored, file: announcement.file });
    manifest.announcements.sort((left, right) => left.file.localeCompare(right.file));
    await writeManifest(rootDir, manifest);
    newlyAnchored.push(announcement.file);
  }

  const siteDir = await writeSite(rootDir, announcements, manifest);
  return {
    siteDir,
    announcements,
    publications: [...manifest.announcements].sort(
      (left, right) => left.file.localeCompare(right.file),
    ),
    newlyAnchored,
  };
}

interface CliOptions {
  checkOnly: boolean;
}

function parseArguments(args: readonly string[]): CliOptions {
  let checkOnly = false;
  for (const argument of args) {
    if (argument === '--check') {
      checkOnly = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { checkOnly };
}

async function runCli(): Promise<void> {
  const cli = parseArguments(process.argv.slice(2));
  const signingKey = process.env.ANNOUNCEMENT_SIGNING_KEY;
  const result = await buildSite({
    rootDir: process.cwd(),
    checkOnly: cli.checkOnly,
    ...(signingKey ? { signingKey } : {}),
    ...(process.env.NIRIUM_AUDIT_URL ? { baseUrl: process.env.NIRIUM_AUDIT_URL } : {}),
    ...(process.env.ANNOUNCEMENT_TAG ? { tag: process.env.ANNOUNCEMENT_TAG } : {}),
  });

  process.stdout.write(
    `${cli.checkOnly ? 'Checked' : 'Published'} ${result.announcements.length} announcements`
    + ` (${result.newlyAnchored.length} newly anchored).\n\n`,
  );
  for (const publication of result.publications) {
    process.stdout.write(`${publication.file}\n  sha256: ${publication.sha256}\n`);
    process.stdout.write(`  cid:    ${publication.cid}\n`);
    process.stdout.write(`  verify: ${verificationCommand(publication)}\n\n`);
  }
  if (!cli.checkOnly) {
    process.stdout.write(`Static site written to ${result.siteDir}\n`);
  }
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined
    && resolve(entryPoint) === resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`announcement-build: ${message}\n`);
    process.exitCode = 1;
  });
}
