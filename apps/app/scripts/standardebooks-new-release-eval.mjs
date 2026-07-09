#!/usr/bin/env node

/**
 * Standard Ebooks new-release connector evaluation — PLANET-3576.
 *
 * Local evaluation only: no Turso writes, no production import, no tagging LLM.
 * Fetches the public Standard Ebooks Atom new-release feed, selects recent titles
 * that are not already represented in production passages when credentials are
 * available, extracts readable book text from official Standard Ebooks XHTML
 * links, and writes review artifacts for a human/import follow-up.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@libsql/client';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const FEED_URL = 'https://standardebooks.org/feeds/atom/new-releases';
const USER_AGENT = 'RandomPage/1.0 StandardEbooks new-release eval (local PLANET-3576; contact gotexis+claw@gmail.com)';
const MIN_CHARS = 180;
const MAX_CHARS = 800;
const SAMPLE_LIMIT = 5;

const args = parseArgs(process.argv.slice(2));
const maxTitles = clamp(Number(args.maxTitles || args['max-titles'] || 3), 1, 15);
const maxFeedEntries = clamp(Number(args.maxFeedEntries || args['max-feed-entries'] || 15), maxTitles, 15);
const reportPath = path.resolve(APP_ROOT, args.report || 'docs/standardebooks-new-release-eval-report.md');
const sampleJsonPath = path.resolve(APP_ROOT, args.samples || 'docs/standardebooks-new-release-eval-samples.json');

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function loadEnvLocal() {
  const envPath = path.join(APP_ROOT, '.env.local');
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(text) {
  return normalize(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, { accept = '*/*', retries = 1 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      headers: { accept, 'user-agent': USER_AGENT },
      redirect: 'follow',
    });
    if (response.ok) return response.text();
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` — ${normalize(body).slice(0, 140)}` : ''}`);
  }
  throw new Error('unreachable retry state');
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseFeed(xml) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true });
  const parsed = parser.parse(xml);
  const entries = asArray(parsed?.feed?.entry).slice(0, maxFeedEntries);
  return entries.map((entry) => {
    const links = asArray(entry.link);
    const findLink = (predicate) => links.find((link) => predicate(link))?.href || null;
    const pageUrl = findLink((link) => link.rel === 'alternate' && link.type === 'application/xhtml+xml') || String(entry.id || '');
    const xhtmlUrl = findLink((link) => link.title === 'XHTML' || String(link.href || '').includes('/text/single-page'));
    const epubUrl = findLink((link) => link.type === 'application/epub+zip' && /compatible epub/i.test(String(link.title || '')))
      || findLink((link) => link.type === 'application/epub+zip');
    return {
      id: String(entry.id || pageUrl),
      title: normalize(entry.title),
      author: normalize(entry.author?.name),
      published: normalize(entry.published),
      updated: normalize(entry.updated),
      summary: normalize(entry.summary?.['#text'] || entry.summary),
      pageUrl,
      xhtmlUrl,
      epubUrl,
      categories: asArray(entry.category).map((cat) => cat.term).filter(Boolean),
    };
  });
}

async function buildExistingTitleSet() {
  const env = { ...loadEnvLocal(), ...process.env };
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
    return { checked: false, reason: 'missing TURSO_DATABASE_URL/TURSO_AUTH_TOKEN', keys: new Set() };
  }
  const client = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const result = await client.execute('select distinct book_title, author from passages');
  const keys = new Set(result.rows.map((row) => `${normalizeKey(row.book_title)}::${normalizeKey(row.author)}`));
  return { checked: true, reason: `loaded ${keys.size} production title/author pairs`, keys };
}

function alreadyRepresented(entry, existing) {
  if (!existing.checked) return false;
  return existing.keys.has(`${normalizeKey(entry.title)}::${normalizeKey(entry.author)}`)
    || [...existing.keys].some((key) => key.startsWith(`${normalizeKey(entry.title)}::`));
}

function sentenceTerminal(text) {
  return /[.!?。！？]['”’)]*$/.test(text);
}

function looksLikeBookText(text) {
  const clean = normalize(text);
  if (clean.length < 90) return false;
  if (/^(contents|title page|copyright|imprint|colophon|dedication|preface|foreword|endnotes?|footnotes?|notes?)$/i.test(clean)) return false;
  if (/standard ebooks|creative commons|public domain|transcriber|ebook producer|cover art|typography|metadata|this particular ebook is based|digital scans from|project gutenberg/i.test(clean)) return false;
  if (/^(chapter|book|part)\s+[ivxlcdm\d]+\.?$/i.test(clean)) return false;
  const letters = (clean.match(/[A-Za-z\p{L}]/gu) || []).length;
  if (letters < clean.length * 0.55) return false;
  if (!sentenceTerminal(clean)) return false;
  return true;
}

function splitIntoCandidates(paragraphs) {
  const candidates = [];
  let buffer = '';
  for (const raw of paragraphs) {
    const text = normalize(raw);
    if (!looksLikeBookText(text)) continue;
    if (text.length >= MIN_CHARS && text.length <= MAX_CHARS) {
      candidates.push(text);
      continue;
    }
    if (text.length < MIN_CHARS) {
      buffer = normalize(`${buffer} ${text}`);
      if (buffer.length >= MIN_CHARS && buffer.length <= MAX_CHARS && sentenceTerminal(buffer)) {
        candidates.push(buffer);
        buffer = '';
      }
      continue;
    }
    const sentences = text.match(/[^.!?。！？]+[.!?。！？]['”’)]*/g) || [text];
    buffer = '';
    for (const sentence of sentences.map(normalize).filter(Boolean)) {
      const next = normalize(`${buffer} ${sentence}`);
      if (next.length > MAX_CHARS) {
        if (buffer.length >= MIN_CHARS && sentenceTerminal(buffer)) candidates.push(buffer);
        buffer = sentence;
      } else {
        buffer = next;
      }
    }
    if (buffer.length >= MIN_CHARS && buffer.length <= MAX_CHARS && sentenceTerminal(buffer)) {
      candidates.push(buffer);
      buffer = '';
    }
  }
  return candidates;
}

function extractParagraphsFromXhtml(xhtml) {
  const $ = cheerio.load(xhtml, { xmlMode: true });
  $('script, style, nav, header, footer, [epub\\:type="titlepage"], [epub\\:type="copyright-page"], [epub\\:type="colophon"], [epub\\:type="imprint"], [epub\\:type="toc"], [epub\\:type="endnotes"], [epub\\:type="footnotes"], [role="doc-endnotes"]').remove();
  const paragraphs = [];
  $('body p').each((_, element) => {
    const text = normalize($(element).text());
    if (text) paragraphs.push(text);
  });
  return paragraphs;
}

async function evaluateEntry(entry) {
  if (!entry.xhtmlUrl) {
    return { ...entry, extractionStatus: 'skipped', skipReason: 'feed entry did not expose XHTML single-page URL', candidateCount: 0, samples: [] };
  }
  try {
    const xhtml = await fetchText(entry.xhtmlUrl, { accept: 'application/xhtml+xml,text/html,*/*' });
    const paragraphs = extractParagraphsFromXhtml(xhtml);
    const candidates = splitIntoCandidates(paragraphs);
    return {
      ...entry,
      extractionStatus: candidates.length ? 'ok' : 'no_candidates',
      paragraphCount: paragraphs.length,
      candidateCount: candidates.length,
      samples: candidates.slice(0, SAMPLE_LIMIT),
    };
  } catch (error) {
    return { ...entry, extractionStatus: 'error', error: error.message, candidateCount: 0, samples: [] };
  }
}

function renderMarkdown({ generatedAt, feedUpdated, existingCheck, selected, skipped }) {
  const okCount = selected.filter((item) => item.extractionStatus === 'ok').length;
  const passageCount = selected.reduce((sum, item) => sum + (item.candidateCount || 0), 0);
  const lines = [
    '# Standard Ebooks new-release connector evaluation — PLANET-3576',
    '',
    `Generated: ${generatedAt}`,
    `Feed: ${FEED_URL}`,
    `Feed updated: ${feedUpdated || 'unknown'}`,
    `Production duplicate check: ${existingCheck.checked ? 'yes' : 'no'} (${existingCheck.reason})`,
    '',
    '## Summary',
    '',
    `- Selected titles: ${selected.length}`,
    `- Titles with readable candidates: ${okCount}`,
    `- Total candidate passages: ${passageCount}`,
    `- Skipped feed titles: ${skipped.length}`,
    '- Production writes: none',
    '- External LLM calls: none',
    '',
    '## Selected titles',
    '',
  ];

  for (const item of selected) {
    lines.push(`### ${item.title} — ${item.author}`);
    lines.push('');
    lines.push(`- Published: ${item.published || 'unknown'}`);
    lines.push(`- Page: ${item.pageUrl}`);
    lines.push(`- Fetch URL: ${item.xhtmlUrl || item.epubUrl || 'none'}`);
    lines.push(`- Extraction status: ${item.extractionStatus}`);
    lines.push(`- Paragraphs inspected: ${item.paragraphCount ?? 0}`);
    lines.push(`- Candidate passages: ${item.candidateCount || 0}`);
    if (item.error) lines.push(`- Error: ${item.error}`);
    if (item.samples?.length) {
      lines.push('- Sample snippets:');
      for (const sample of item.samples.slice(0, SAMPLE_LIMIT)) {
        lines.push(`  - ${sample.slice(0, 260)}${sample.length > 260 ? '…' : ''}`);
      }
    }
    lines.push('');
  }

  lines.push('## Skipped titles / reasons');
  lines.push('');
  for (const item of skipped) {
    lines.push(`- ${item.title || '(untitled)'} — ${item.author || '(unknown author)'}: ${item.skipReason}`);
  }
  if (!skipped.length) lines.push('- None');
  lines.push('');
  lines.push('## Boundary notes');
  lines.push('');
  lines.push('- This is a review artifact only; no rows were inserted into Turso and nothing enters Discover/push.');
  lines.push('- Uses public Standard Ebooks Atom/XHTML links only; no patron/private OPDS feed is required.');
  lines.push('- Candidate snippets are filtered for prose-like book text and reject obvious Standard Ebooks boilerplate/front matter/TOC/endnote text.');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const feedXml = await fetchText(FEED_URL, { accept: 'application/atom+xml,application/xml,text/xml,*/*' });
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true });
  const feedParsed = parser.parse(feedXml);
  const feedUpdated = normalize(feedParsed?.feed?.updated);
  const entries = parseFeed(feedXml);
  const existingCheck = await buildExistingTitleSet().catch((error) => ({ checked: false, reason: `duplicate check failed: ${error.message}`, keys: new Set() }));

  const selected = [];
  const skipped = [];
  for (const entry of entries) {
    if (alreadyRepresented(entry, existingCheck)) {
      skipped.push({ ...entry, skipReason: 'already represented in production passages by title/author' });
      continue;
    }
    if (!entry.xhtmlUrl && !entry.epubUrl) {
      skipped.push({ ...entry, skipReason: 'no official XHTML/EPUB fetch URL found in feed entry' });
      continue;
    }
    if (selected.length >= maxTitles) {
      skipped.push({ ...entry, skipReason: `not evaluated; max titles (${maxTitles}) already selected` });
      continue;
    }
    const evaluated = await evaluateEntry(entry);
    selected.push(evaluated);
    await sleep(250);
  }

  await mkdir(path.dirname(reportPath), { recursive: true });
  await mkdir(path.dirname(sampleJsonPath), { recursive: true });
  const payload = {
    generatedAt,
    feedUrl: FEED_URL,
    feedUpdated,
    productionDuplicateCheck: { checked: existingCheck.checked, reason: existingCheck.reason },
    selected,
    skipped,
  };
  await writeFile(sampleJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(reportPath, renderMarkdown({ generatedAt, feedUpdated, existingCheck, selected, skipped }));

  const okCount = selected.filter((item) => item.extractionStatus === 'ok').length;
  const passageCount = selected.reduce((sum, item) => sum + (item.candidateCount || 0), 0);
  console.log(`Standard Ebooks new-release eval complete: selected=${selected.length} ok=${okCount} candidates=${passageCount}`);
  console.log(`Report: ${path.relative(APP_ROOT, reportPath)}`);
  console.log(`Samples: ${path.relative(APP_ROOT, sampleJsonPath)}`);
  if (!okCount) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
