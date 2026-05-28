#!/usr/bin/env node
/**
 * slice-epub.mjs — PLANET-1990
 *
 * EPUB chapter-first-paragraph slicer for RandomPage v2.
 *
 * Reads EPUB(s) and extracts the first meaningful paragraph of each chapter.
 * Emits clean passage-candidate records as JSONL to stdout.
 *
 * Single-file mode:
 *   node slice-epub.mjs --input <epub-path> [--max-per-book N] [--openlib-id /works/...]
 *
 * Batch (stdin) mode — accepts PLANET-1989 fetch-by-metadata JSONL:
 *   cat fetch-result.jsonl | node slice-epub.mjs [--max-per-book N]
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';

// ---------- args ----------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const MAX_DEFAULT = 10;
const MAX_CAP = 20;
const MIN_PASSAGE_CHARS = 180;
const MAX_PASSAGE_CHARS = 800;
let maxPerBook = Number(args['max-per-book'] || MAX_DEFAULT);
if (!Number.isFinite(maxPerBook) || maxPerBook < 1) maxPerBook = MAX_DEFAULT;
if (maxPerBook > MAX_CAP) maxPerBook = MAX_CAP;

const SKIP_CHAPTER_REGEX =
  /^(copyright|前言|目录|table of contents|acknowledg|about the author|preface|dedication|epigraph|contents|colophon|appendix|index|bibliography|notes|cover|title page)/i;

// ---------- core ----------

function sha256(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

function collapseWs(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function detectLanguageFromText(text) {
  if (!text) return 'eng';
  // crude CJK heuristic: chars in basic CJK unified ideographs
  let cjk = 0;
  let alpha = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x4e00 && cp <= 0x9fff) cjk += 1;
    if (/\p{L}/u.test(ch)) alpha += 1;
  }
  if (alpha === 0) return 'eng';
  return cjk / alpha > 0.3 ? 'chi' : 'eng';
}

function normalizeLang(raw) {
  if (!raw) return null;
  const v = String(raw).toLowerCase().trim();
  if (v.startsWith('zh') || v.startsWith('chi') || v === 'cmn') return 'chi';
  if (v.startsWith('en') || v.startsWith('eng')) return 'eng';
  return v.slice(0, 3) || null;
}

function asArray(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

async function readOpf(zip) {
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('missing META-INF/container.xml');
  const containerXml = await containerFile.async('string');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
  });
  const c = parser.parse(containerXml);
  const rootfiles = asArray(c?.container?.rootfiles?.rootfile);
  const opfRel = rootfiles[0]?.['@_full-path'];
  if (!opfRel) throw new Error('cannot locate opf path');
  const opfFile = zip.file(opfRel);
  if (!opfFile) throw new Error(`opf not in zip: ${opfRel}`);
  const opfXml = await opfFile.async('string');
  const opf = parser.parse(opfXml);
  return { opf, opfPath: opfRel };
}

function buildManifestMap(opf) {
  const items = asArray(opf?.package?.manifest?.item);
  const map = new Map();
  for (const it of items) {
    const id = it?.['@_id'];
    const href = it?.['@_href'];
    if (id && href) map.set(id, href);
  }
  return map;
}

function getSpine(opf) {
  return asArray(opf?.package?.spine?.itemref)
    .map((ref) => ref?.['@_idref'])
    .filter(Boolean);
}

function getMetadata(opf) {
  const md = opf?.package?.metadata || {};
  const pick = (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object') {
      if (typeof v['#text'] === 'string') return v['#text'];
    }
    return null;
  };
  const title = pick(md['dc:title']) || pick(md.title) || '';
  const creators = asArray(md['dc:creator'] || md.creator)
    .map(pick)
    .filter(Boolean);
  const language = pick(md['dc:language']) || pick(md.language) || null;
  return {
    title: typeof title === 'string' ? title.trim() : '',
    authors: creators.map((c) => String(c).trim()).filter(Boolean),
    language: normalizeLang(language),
  };
}

function resolveHref(opfPath, href) {
  const base = path.posix.dirname(opfPath.split(/[\\/]/).join('/'));
  const joined = base && base !== '.' ? `${base}/${href}` : href;
  // normalize ../ etc
  const parts = [];
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function uppercaseRatio(text) {
  let upper = 0;
  let alpha = 0;
  for (const ch of text) {
    if (/[A-Za-z]/.test(ch)) {
      alpha += 1;
      if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) upper += 1;
    }
  }
  if (alpha === 0) return 0;
  return upper / alpha;
}

function isLikelyReferenceNoteFragment(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (normalized.startsWith('↩')) return true;
  if (/^(?:note|notes|footnote|footnotes|endnote|endnotes)\s*[:.\-—]/i.test(normalized)) return true;
  if (/^(?:\[[^\]]{1,80}\]|\([^)]{1,80}\))\s*(?:note|footnote|editor|translator|transcriber)/i.test(normalized)) return true;
  if (/^(?:for\s+.{1,80},\s*)?(?:see|cf\.)\s+(?:note|notes|footnote|footnotes|endnote|endnotes)\b|^for\s+.{1,80},\s*see\s+(?:note|notes|footnote|footnotes|endnote|endnotes)\b/i.test(normalized)) return true;
  return ((normalized.slice(0, 220).match(/(?:↩|\[[0-9ivxlcdm]+\]|\([0-9ivxlcdm]+\)|\^[0-9]+|†|‡)/gi) ?? []).length >= 3);
}

async function sliceEpub(epubPath, meta = {}) {
  const buf = await readFile(epubPath);
  const zip = await JSZip.loadAsync(buf);
  const { opf, opfPath } = await readOpf(zip);
  const md = getMetadata(opf);
  const manifest = buildManifestMap(opf);
  const spine = getSpine(opf);

  const passages = [];
  const seenHeads = new Set();
  let chapterIndex = 0;

  for (const idref of spine) {
    if (passages.length >= maxPerBook) break;
    chapterIndex += 1;
    const href = manifest.get(idref);
    if (!href) continue;
    const fullPath = resolveHref(opfPath, href);
    const file = zip.file(fullPath);
    if (!file) continue;
    let html;
    try {
      html = await file.async('string');
    } catch {
      continue;
    }

    const $ = cheerio.load(html);
    const titleEl = $('h1, h2, h3').first();
    const chapterTitle = collapseWs(titleEl.text() || '');
    if (chapterTitle && SKIP_CHAPTER_REGEX.test(chapterTitle)) continue;

    const paragraphs = $('p').toArray();
    for (const p of paragraphs) {
      const text = collapseWs($(p).text() || '');
      if (!text) continue;
      if (text.length < MIN_PASSAGE_CHARS || text.length > MAX_PASSAGE_CHARS) continue;
      if (uppercaseRatio(text) > 0.8) continue;
      if (isLikelyReferenceNoteFragment(text)) continue;
      if (text.includes('http://') || text.includes('https://') || text.includes('@')) continue;
      const head = text.slice(0, 60);
      if (seenHeads.has(head)) continue;
      seenHeads.add(head);

      const rec = {
        source_epub: epubPath,
        openlib_id: meta.openlib_id || args['openlib-id'] || null,
        bookworm_book_id: meta.bookworm_book_id || null,
        book_title: meta.title || md.title || '',
        book_authors: md.authors.length ? md.authors : meta.authors || [],
        chapter_index: chapterIndex,
        chapter_title: chapterTitle || null,
        text,
        char_count: text.length,
        word_count: text.split(/\s+/).filter(Boolean).length,
        language: md.language || null,
        sha256: sha256(text),
      };
      passages.push(rec);
      break; // only first qualifying paragraph per chapter
    }
  }

  // language fallback: use first passage if metadata missing
  if (passages.length && !passages[0].language) {
    const lang = detectLanguageFromText(passages[0].text);
    for (const p of passages) p.language = lang;
  }

  return passages;
}

// ---------- driver ----------

async function processBook(epubPath, meta = {}) {
  if (!existsSync(epubPath)) {
    process.stderr.write(`warn: missing epub ${epubPath}\n`);
    return { emitted: 0, thin: false };
  }
  let passages;
  try {
    passages = await sliceEpub(epubPath, meta);
  } catch (err) {
    process.stderr.write(`error: failed to slice ${epubPath}: ${err.message}\n`);
    return { emitted: 0, thin: false };
  }
  if (passages.length < 3) {
    process.stderr.write(
      `warn: ${epubPath} yielded only ${passages.length} passages, skipping book\n`,
    );
    return { emitted: 0, thin: true };
  }
  for (const rec of passages) {
    process.stdout.write(JSON.stringify(rec) + '\n');
  }
  return { emitted: passages.length, thin: false };
}

async function readStdinLines() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buf += chunk;
    });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

async function main() {
  let booksProcessed = 0;
  let passagesEmitted = 0;
  let booksSkippedThin = 0;

  if (args.input) {
    const meta = {
      openlib_id: args['openlib-id'] || null,
    };
    const r = await processBook(args.input, meta);
    booksProcessed += 1;
    passagesEmitted += r.emitted;
    if (r.thin) booksSkippedThin += 1;
  } else {
    // stdin batch
    if (process.stdin.isTTY) {
      process.stderr.write(
        'usage: slice-epub.mjs --input <epub> | cat fetch.jsonl | slice-epub.mjs\n',
      );
      process.exit(2);
    }
    const raw = await readStdinLines();
    const lines = raw.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.status !== 'ok') continue;
      if (!obj.local_path) continue;
      const meta = {
        openlib_id: obj.openlib_id || null,
        bookworm_book_id: obj.bookworm_book_id || null,
        title: obj.title || null,
        authors: obj.authors || [],
      };
      const r = await processBook(obj.local_path, meta);
      booksProcessed += 1;
      passagesEmitted += r.emitted;
      if (r.thin) booksSkippedThin += 1;
    }
  }

  process.stderr.write(
    `summary: books_processed=${booksProcessed} passages_emitted=${passagesEmitted} books_skipped_thin=${booksSkippedThin}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
