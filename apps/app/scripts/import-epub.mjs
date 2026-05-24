#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ALLOWED_LICENSES = new Set(['public-domain', 'cc0', 'cc-by', 'permission']);
const MIN_PASSAGE_CHARS = 180;
const TARGET_PASSAGE_CHARS = 300;
const MAX_PASSAGE_CHARS = 800;
const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const parsed = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      if (!parsed.file) parsed.file = token;
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function unzipText(epubPath, innerPath) {
  return execFileSync('unzip', ['-p', epubPath, innerPath], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
}

function listZip(epubPath) {
  return execFileSync('unzip', ['-Z1', epubPath], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function getAttr(tag, attr) {
  const match = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
  return match?.[1] || null;
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripXml(value) {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(xml, tagName) {
  const match = xml.match(new RegExp(`<[^:>]*:?${tagName}[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${tagName}>`, 'i'));
  return match ? stripXml(match[1]) : null;
}

function resolveOpfPath(epubPath) {
  const container = unzipText(epubPath, 'META-INF/container.xml');
  const rootfile = container.match(/<rootfile\b[^>]+>/i)?.[0];
  const fullPath = rootfile ? getAttr(rootfile, 'full-path') : null;
  if (!fullPath) throw new Error('EPUB container missing rootfile full-path');
  return fullPath;
}

function dirnamePosix(filePath) {
  const dir = path.posix.dirname(filePath);
  return dir === '.' ? '' : dir;
}

function parseOpf(epubPath, opfPath) {
  const opf = unzipText(epubPath, opfPath);
  const base = dirnamePosix(opfPath);
  const manifest = new Map();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = match[0];
    const id = getAttr(tag, 'id');
    const href = getAttr(tag, 'href');
    const mediaType = getAttr(tag, 'media-type') || '';
    if (!id || !href) continue;
    manifest.set(id, { href: path.posix.normalize(path.posix.join(base, href)), mediaType });
  }

  const spineIds = [...opf.matchAll(/<itemref\b[^>]*>/gi)]
    .map((match) => getAttr(match[0], 'idref'))
    .filter(Boolean);

  const readingOrder = spineIds
    .map((id) => manifest.get(id))
    .filter((item) => item && /xhtml|html/i.test(item.mediaType))
    .map((item) => item.href);

  return {
    title: args.title || tagText(opf, 'title') || 'Untitled EPUB',
    author: args.author || tagText(opf, 'creator') || 'Unknown',
    readingOrder,
  };
}

function htmlToText(html) {
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?(p|br|div|section|article|h[1-6]|li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(withBreaks)
    .split(/\n+/g)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function slicePassages(text, maxPassages) {
  const paragraphs = text
    .split(/\n+/g)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= MIN_PASSAGE_CHARS && p.length <= MAX_PASSAGE_CHARS);
  const passages = [];
  let buffer = '';
  for (const paragraph of paragraphs) {
    const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (next.length < TARGET_PASSAGE_CHARS) {
      buffer = next;
      continue;
    }
    if (next.length <= MAX_PASSAGE_CHARS) {
      passages.push(next);
      buffer = '';
    } else if (buffer) {
      passages.push(buffer);
      buffer = paragraph;
    }
    if (passages.length >= maxPassages) break;
  }
  if (passages.length < maxPassages && buffer.length >= MIN_PASSAGE_CHARS && buffer.length <= MAX_PASSAGE_CHARS) {
    passages.push(buffer);
  }
  return passages;
}

async function applyPassages({ passages, title, author, language }) {
  const { PrismaClient } = await import('../src/server/generated/prisma/index.js');
  const prisma = new PrismaClient();
  try {
    for (const text of passages) {
      await prisma.passage.create({
        data: {
          id: randomUUID(),
          text,
          bookTitle: title,
          author,
          chapter: null,
          tags: '[]',
          language,
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const file = args.file;
  if (!file || !existsSync(file)) throw new Error('Usage: node scripts/import-epub.mjs <book.epub> --license public-domain|cc0|cc-by|permission [--apply]');

  const license = String(args.license || '').toLowerCase();
  if (!ALLOWED_LICENSES.has(license)) {
    throw new Error(`Refusing EPUB import without allowed --license (${[...ALLOWED_LICENSES].join(', ')}). Use metadata-only source adapters for protected books.`);
  }

  const maxPassages = Math.max(1, Math.min(Number(args['max-passages'] || 25), 200));
  const language = String(args.language || 'en');
  const opfPath = resolveOpfPath(file);
  const { title, author, readingOrder } = parseOpf(file, opfPath);
  if (readingOrder.length === 0) throw new Error('EPUB spine has no XHTML/HTML reading-order items');

  const zipEntries = new Set(listZip(file));
  const chapterTexts = [];
  for (const itemPath of readingOrder) {
    if (!zipEntries.has(itemPath)) continue;
    chapterTexts.push(htmlToText(unzipText(file, itemPath)));
    if (chapterTexts.join('\n').split(/\s+/).length > maxPassages * 400) break;
  }

  const passages = slicePassages(chapterTexts.join('\n\n'), maxPassages);
  if (args.apply) await applyPassages({ passages, title, author, language });

  console.log(JSON.stringify({
    status: args.apply ? 'inserted' : 'dry-run',
    file,
    title,
    author,
    language,
    license,
    source_policy: 'full-text import allowed only because operator asserted an approved license',
    passage_length_policy: { target_chars: TARGET_PASSAGE_CHARS, min_chars: MIN_PASSAGE_CHARS, max_chars: MAX_PASSAGE_CHARS },
    passages: passages.length,
    sample: passages.slice(0, 2),
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
