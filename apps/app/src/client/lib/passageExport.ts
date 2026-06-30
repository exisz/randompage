export interface ExportPassage {
  id: string;
  text: string;
  bookTitle: string;
  author: string;
  chapter?: string | null;
  tags?: string | null;
  note?: string | null;
  collections?: string[];
  annotations?: { quote: string; note: string }[];
}

export interface ExportBundleOptions {
  title: string;
  description?: string;
  passages: ExportPassage[];
  format?: 'html' | 'txt' | 'md';
}

export interface EmailPassageExportResult {
  mode: 'mailto' | 'download-fallback';
}

function parseTags(raw: string | null | undefined) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return raw.split(',').map(tag => tag.trim()).filter(Boolean);
  }
}

function clean(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function canonicalUrl(passageId: string) {
  return `https://app.randompage.rollersoft.com.au/discover?passageId=${encodeURIComponent(passageId)}&source=discover`;
}

function escapeMarkdown(value: string) {
  return clean(value).replace(/([\\`*_{}\[\]()#+.!|>-])/g, '\\$1');
}

function safeFileName(title: string, extension: 'html' | 'txt' | 'md') {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'randompage-export';
  return `${base}.${extension}`;
}


export function buildPassageMarkdownExport(passage: ExportPassage) {
  const title = clean(passage.bookTitle) || 'Untitled RandomPage passage';
  const author = clean(passage.author) || 'Unknown author';
  const tags = parseTags(passage.tags);
  const collections = (passage.collections ?? []).map(clean).filter(Boolean);
  const annotations = (passage.annotations ?? [])
    .map(annotation => ({ quote: clean(annotation.quote), note: clean(annotation.note) }))
    .filter(annotation => annotation.quote || annotation.note);
  const url = canonicalUrl(passage.id);
  const quoteBlock = clean(passage.text).split(/\n+/).map(line => `> ${line}`).join('\n');

  const frontmatter = [
    '---',
    'source: RandomPage',
    `randompage_url: ${url}`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `author: "${author.replace(/"/g, '\\"')}"`,
    passage.chapter ? `chapter: "${clean(passage.chapter).replace(/"/g, '\\"')}"` : '',
    tags.length ? `tags: [${tags.map(tag => `"${tag.replace(/"/g, '\\"')}"`).join(', ')}]` : 'tags: []',
    collections.length ? `collections: [${collections.map(collection => `"${collection.replace(/"/g, '\\"')}"`).join(', ')}]` : 'collections: []',
    '---',
  ].filter(Boolean).join('\n');

  const body = [
    `# ${escapeMarkdown(title)}`,
    `**Author:** ${escapeMarkdown(author)}`,
    passage.chapter ? `**Chapter:** ${escapeMarkdown(passage.chapter)}` : '',
    `**RandomPage URL:** ${url}`,
    tags.length ? `**Tags:** ${tags.map(tag => `#${tag.replace(/\s+/g, '-')}`).join(' ')}` : '',
    collections.length ? `**Collections:** ${collections.map(escapeMarkdown).join(', ')}` : '',
    '',
    '## Excerpt',
    quoteBlock,
    passage.note ? ['', '## Private note', clean(passage.note)].join('\n') : '',
    annotations.length ? ['', '## Line-level thoughts', ...annotations.map((annotation, index) => [
      `${index + 1}. > ${annotation.quote}`,
      annotation.note ? `   ${annotation.note}` : '',
    ].filter(Boolean).join('\n'))].join('\n') : '',
    '',
    '_Exported from RandomPage. This file contains only your saved passage excerpt, private note, and line-level thoughts — no summaries or new content._',
  ].filter(line => line !== '').join('\n');

  return `${frontmatter}\n\n${body}\n`;
}

export function buildPassageExportText({ title, description, passages }: ExportBundleOptions) {
  const header = [
    title,
    description ? clean(description) : '',
    `Exported from RandomPage on ${new Date().toLocaleDateString()}`,
    'These are your saved/user-owned book passages. No summaries or generated content are included.',
  ].filter(Boolean).join('\n');

  const body = passages.map((passage, index) => {
    const tags = parseTags(passage.tags);
    return [
      `\n${index + 1}. ${clean(passage.bookTitle) || 'Untitled'}${passage.author ? ` — ${clean(passage.author)}` : ''}`,
      passage.chapter ? `Chapter: ${clean(passage.chapter)}` : '',
      tags.length ? `Tags: ${tags.map(tag => `#${tag}`).join(' ')}` : '',
      passage.note ? `Private note: ${clean(passage.note)}` : '',
      `RandomPage URL: ${canonicalUrl(passage.id)}`,
      '',
      clean(passage.text),
    ].filter(line => line !== '').join('\n');
  }).join('\n\n---\n');

  return `${header}\n\n${body}\n`;
}

export function buildPassageExportHtml({ title, description, passages }: ExportBundleOptions) {
  const items = passages.map((passage, index) => {
    const tags = parseTags(passage.tags);
    const url = canonicalUrl(passage.id);
    return `<article class="passage">
      <p class="kicker">Passage ${index + 1} of ${passages.length}</p>
      <h2>${escapeHtml(clean(passage.bookTitle) || 'Untitled')}</h2>
      <p class="meta">${escapeHtml(clean(passage.author) || 'Unknown author')}${passage.chapter ? ` · ${escapeHtml(clean(passage.chapter))}` : ''}</p>
      ${tags.length ? `<p class="tags">${tags.map(tag => `<span>#${escapeHtml(tag)}</span>`).join(' ')}</p>` : ''}
      ${passage.note ? `<aside><strong>Your private note</strong><br>${escapeHtml(clean(passage.note))}</aside>` : ''}
      <p class="text">${escapeHtml(clean(passage.text))}</p>
      <p class="url"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
    </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Georgia, 'Noto Serif SC', serif; line-height: 1.65; max-width: 720px; margin: 0 auto; padding: 32px 20px; color: #1f1b16; background: #fffaf3; }
    header { border-bottom: 1px solid #d7c7ae; margin-bottom: 28px; padding-bottom: 18px; }
    h1 { font-size: 2rem; margin: 0 0 8px; }
    h2 { font-size: 1.35rem; margin: 4px 0; }
    .meta, .kicker, .url, .tags, header p { color: #6f6254; }
    .kicker { text-transform: uppercase; letter-spacing: 0.16em; font-size: 0.75rem; }
    .passage { break-inside: avoid; margin: 0 0 32px; padding-bottom: 24px; border-bottom: 1px solid #eadfce; }
    .text { white-space: pre-wrap; }
    aside { background: #fff0c2; border-left: 4px solid #d8a600; padding: 10px 12px; margin: 14px 0; }
    .tags span { margin-right: 0.35rem; }
    a { color: #77520e; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    ${description ? `<p>${escapeHtml(clean(description))}</p>` : ''}
    <p>Exported from RandomPage on ${escapeHtml(new Date().toLocaleDateString())}. These are your saved/user-owned book passages; no summaries or generated content are included.</p>
  </header>
  ${items}
</body>
</html>`;
}

export function downloadPassageExport(options: ExportBundleOptions) {
  const format = options.format ?? 'html';
  const content = format === 'md' && options.passages[0]
    ? buildPassageMarkdownExport(options.passages[0])
    : format === 'txt'
      ? buildPassageExportText(options)
      : buildPassageExportHtml(options);
  const blob = new Blob([content], { type: format === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(options.title, format);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyPassageExport(options: ExportBundleOptions) {
  const text = buildPassageExportText(options);
  await navigator.clipboard.writeText(text);
}

export function downloadMarkdownPassageExport(passage: ExportPassage) {
  downloadPassageExport({ title: `${clean(passage.bookTitle) || 'RandomPage'} Markdown export`, passages: [passage], format: 'md' });
}

export async function copyMarkdownPassageExport(passage: ExportPassage) {
  await navigator.clipboard.writeText(buildPassageMarkdownExport(passage));
}

export async function emailPassageExport(options: ExportBundleOptions, destinationEmail: string): Promise<EmailPassageExportResult> {
  const email = destinationEmail.trim();
  const subject = `${options.title} — RandomPage saved passages`;
  const body = buildPassageExportText(options);
  const href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  if (href.length > 1800) {
    try {
      await copyPassageExport(options);
    } catch {
      // Clipboard can fail on some browsers; the TXT download is still the explicit email-ready fallback.
    }
    downloadPassageExport({ ...options, format: 'txt' });
    return { mode: 'download-fallback' };
  }

  window.location.href = href;
  return { mode: 'mailto' };
}
