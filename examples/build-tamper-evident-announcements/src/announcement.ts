import { createHash } from 'node:crypto';

export interface Announcement {
  file: string;
  slug: string;
  title: string;
  date: string;
  kind: string;
  body: string;
  sha256: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function sha256Hex(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export function parseAnnouncement(file: string, raw: Buffer): Announcement {
  const text = raw.toString('utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) {
    throw new Error(`${file}: expected YAML-like front matter between --- lines`);
  }

  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const separator = line.indexOf(':');
    if (separator < 1) {
      throw new Error(`${file}: invalid front matter line: ${line}`);
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    fields.set(key, value);
  }

  const title = fields.get('title') ?? '';
  const date = fields.get('date') ?? '';
  const kind = fields.get('kind') ?? 'note';
  if (title === '') throw new Error(`${file}: front matter is missing title`);
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`${file}: front matter date must be YYYY-MM-DD`);
  }

  const body = (match[2] ?? '').trim();
  if (body === '') throw new Error(`${file}: announcement body is empty`);

  return {
    file,
    slug: file.replace(/\.md$/, ''),
    title,
    date,
    kind,
    body,
    sha256: sha256Hex(raw),
  };
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

export function renderAnnouncementBody(body: string): string {
  const blocks = body.split(/\r?\n\s*\r?\n/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block) => {
    const heading = /^##\s+(.+)$/.exec(block);
    if (heading) {
      return `<h2>${renderInline(heading[1] ?? '')}</h2>`;
    }

    const lines = block.split(/\r?\n/);
    if (lines.length > 0 && lines.every((line) => /^-\s+/.test(line))) {
      const items = lines.map((line) => `<li>${renderInline(line.replace(/^-\s+/, ''))}</li>`);
      return `<ul>\n${items.join('\n')}\n</ul>`;
    }

    return `<p>${lines.map(renderInline).join('<br>\n')}</p>`;
  }).join('\n');
}
