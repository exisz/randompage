#!/usr/bin/env node
/**
 * loc-reviewed-ingest.mjs — PLANET-3882
 *
 * Review-first, small-batch ingestion path for Library of Congress Selected
 * Digitized Books .txt files. Dry-run is default and writes local artifacts.
 * Production apply requires --apply --ack-reviewed plus an explicit reviewed list.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const MIN_PASSAGE_CHARS = 180;
const TARGET_PASSAGE_CHARS = 300;
const MAX_PASSAGE_CHARS = 800;
const DEFAULT_REVIEWED_LIST = 'docs/loc-reviewed-items.json';
const DEFAULT_REPORT = 'docs/loc-reviewed-ingest-report.md';
const DEFAULT_SAMPLE_JSON = 'docs/loc-reviewed-ingest-samples.json';
const DEFAULT_CACHE = '.cache/loc-reviewed-ingest';
const USER_AGENT = 'RandomPage/1.0 LOC reviewed ingest (tiny reviewed batch; contact gotexis+claw@gmail.com)';

const args = parseArgs(process.argv.slice(2));
const apply = Boolean(args.apply);
const ackReviewed = Boolean(args['ack-reviewed']);
const maxItems = clampInt(args['max-items'], 1, 5, 1);
const maxPassagesPerItem = clampInt(args['max-passages-per-item'], 1, 25, 10);
const reviewedPath = path.resolve(APP_ROOT, args.reviewed || DEFAULT_REVIEWED_LIST);
const reportPath = path.resolve(APP_ROOT, args.report || DEFAULT_REPORT);
const samplesPath = path.resolve(APP_ROOT, args.samples || DEFAULT_SAMPLE_JSON);
const cacheDir = path.resolve(APP_ROOT, args.cache || DEFAULT_CACHE);

function parseArgs(argv) {
  const parsed = { json: false, refresh: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else { parsed[key] = next; i += 1; }
  }
  return parsed;
}
function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function fetchText(url, { retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetch(url, { headers: { accept: 'text/plain,*/*', 'user-agent': USER_AGENT }, redirect: 'follow' });
    if (res.ok) return res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(1000 * (attempt + 1)); continue; }
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ` — ${normalize(body).slice(0, 140)}` : ''}`);
  }
  throw new Error('unreachable fetch retry state');
}
async function cachedText(cacheName, url) {
  await mkdir(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, cacheName.replace(/[^A-Za-z0-9_.-]/g, '_'));
  if (!args.refresh && existsSync(filePath)) return readFile(filePath, 'utf8');
  const text = await fetchText(url);
  await writeFile(filePath, text);
  await sleep(500);
  return text;
}
function normalize(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
function cleanLocText(raw) {
  return String(raw || '')
    .replace(/\r/g, '')
    .replace(/\f/g, '\n')
    .replace(/^\s*(?:Library of Congress|Digitized by|This book is a preservation facsimile|Funding from the Library of Congress).*$/gim, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => {
      if (!line) return true;
      if (/^\d+$/.test(line)) return false;
      if (/^[^A-Za-z]{1,12}$/.test(line)) return false;
      if (line.length < 3) return false;
      return true;
    })
    .join('\n')
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function isLikelyReferenceNoteFragment(text) {
  const n = normalize(text);
  if (!n) return false;
  if (n.startsWith('↩')) return true;
  if (/^(?:note|notes|footnote|footnotes|endnote|endnotes)\s*[:.\-—]/i.test(n)) return true;
  if (/^(?:for\s+.{1,80},\s*)?(?:see|cf\.)\s+(?:note|notes|footnote|footnotes|endnote|endnotes)\b/i.test(n)) return true;
  return ((n.slice(0, 220).match(/(?:↩|\[[0-9ivxlcdm]+\]|\([0-9ivxlcdm]+\)|\^[0-9]+|†|‡)/gi) ?? []).length >= 3);
}
function isLikelyChapterListFragment(text) {
  const n = normalize(text);
  const chapterMatches = n.match(/(?:^|[\s.;:!?。！？])(?:chapter|chap\.|book|part|section)\s+(?:[0-9ivxlcdm]+|[a-z][a-z'’-]{1,30})(?=[\s.:;,-])/gi) ?? [];
  if (chapterMatches.length < 4) return false;
  const proseWords = n.match(/\b(?:the|and|but|for|with|from|that|this|they|their|there|then|when|where|while|into|upon|because|said|was|were|had|have|will|would|could|should|not)\b/gi) ?? [];
  return chapterMatches.length >= 6 || proseWords.length / Math.max(1, n.split(/\s+/).length) < 0.18;
}
function hasTerminalSentencePunctuation(text) { return /[.!?…。！？]["'”’）)\]》」』]*$/.test(normalize(text)); }
function isLikelyBoilerplateOrOcrNoise(text) {
  const n = normalize(text);
  if (/\b(?:copyright|all rights reserved|publisher|publishers|printed in|library of congress|isbn|contents|table of contents|index|bibliography)\b/i.test(n.slice(0, 260))) return true;
  const punctuation = (n.match(/[^\p{L}\p{N}\s]/gu) || []).length;
  if (punctuation / Math.max(1, n.length) > 0.2) return true;
  const weirdTokens = n.match(/[A-Za-z]*[0-9][A-Za-z]+|[A-Za-z]+[0-9][A-Za-z]*/g) || [];
  if (weirdTokens.length >= 4) return true;
  return false;
}
function rejectionReason(text) {
  const n = normalize(text);
  if (n.length < MIN_PASSAGE_CHARS) return 'too-short';
  if (n.length > MAX_PASSAGE_CHARS) return 'too-long';
  if (isLikelyReferenceNoteFragment(n)) return 'reference-note-or-footnote-fragment';
  if (isLikelyChapterListFragment(n)) return 'chapter-list-fragment';
  if (isLikelyBoilerplateOrOcrNoise(n)) return 'boilerplate-or-ocr-noise';
  if (!hasTerminalSentencePunctuation(n)) return 'non-terminal-ending';
  const letters = (n.match(/[A-Za-z]/g) || []).length;
  if (letters / Math.max(1, n.length) <= 0.55) return 'low-letter-ratio';
  return null;
}
function splitOnSentenceBoundaries(text) {
  return (normalize(text).match(/[^.!?…。！？]+[.!?…。！？]["'”’）)\]》」』]*/g) || []).map((part) => part.trim()).filter(Boolean);
}
function sentenceBoundaryChunks(text) {
  const units = splitOnSentenceBoundaries(text).filter((unit) => unit.length <= MAX_PASSAGE_CHARS && !isLikelyReferenceNoteFragment(unit) && !isLikelyChapterListFragment(unit));
  const chunks = [];
  let buffer = '';
  for (const unit of units) {
    const next = buffer ? `${buffer} ${unit}` : unit;
    if (next.length <= MAX_PASSAGE_CHARS) {
      buffer = next;
      if (buffer.length >= TARGET_PASSAGE_CHARS) { if (!rejectionReason(buffer)) chunks.push(buffer); buffer = ''; }
    } else { if (!rejectionReason(buffer)) chunks.push(buffer); buffer = unit; }
  }
  if (!rejectionReason(buffer)) chunks.push(buffer);
  return chunks;
}
function slicePassages(text, maxPassages = 500) {
  const paragraphs = text.split(/\n+/g).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 0 && !isLikelyReferenceNoteFragment(p) && !isLikelyChapterListFragment(p));
  const passages = [];
  let buffer = '';
  for (const paragraph of paragraphs) {
    const candidates = paragraph.length <= MAX_PASSAGE_CHARS ? [paragraph] : sentenceBoundaryChunks(paragraph);
    for (const candidate of candidates) {
      const next = buffer ? `${buffer}\n\n${candidate}` : candidate;
      if (next.length < TARGET_PASSAGE_CHARS) { buffer = next; continue; }
      if (!rejectionReason(next)) { passages.push(next); buffer = ''; }
      else if (!rejectionReason(buffer)) { passages.push(buffer); buffer = candidate; }
      else buffer = candidate;
      if (passages.length >= maxPassages) break;
    }
    if (passages.length >= maxPassages) break;
  }
  if (passages.length < maxPassages && !rejectionReason(buffer)) passages.push(buffer);
  return passages.slice(0, maxPassages);
}
function sha256Hex(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }
function normalizeTitle(value) { return normalize(value).toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim(); }
function loadReviewedItems() {
  if (!existsSync(reviewedPath)) throw new Error(`reviewed item list not found: ${reviewedPath}`);
  const parsed = JSON.parse(readFileSync(reviewedPath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('reviewed item list must be a JSON array');
  return parsed.filter((item) => item?.textUrl && item.reviewed === true).slice(0, maxItems);
}
async function evaluateReviewedItem(item) {
  const raw = await cachedText(item.filename || sha256Hex(item.textUrl).slice(0, 12), item.textUrl);
  const clean = cleanLocText(raw);
  const bodyText = clean.length > 12000 ? clean.slice(6000) : clean;
  const sliced = slicePassages(bodyText, maxPassagesPerItem * 3);
  const accepted = [];
  const rejected = {};
  for (const text of sliced) {
    const reason = rejectionReason(text);
    if (reason) rejected[reason] = (rejected[reason] || 0) + 1;
    else accepted.push(text);
    if (accepted.length >= maxPassagesPerItem) break;
  }
  return {
    filename: item.filename,
    itemId: item.itemId,
    title: normalize(item.title || item.filename?.replace(/\.txt$/i, '') || 'LOC Selected Digitized Book'),
    author: normalize(item.author || 'Unknown'),
    sourceUrl: item.textUrl,
    locResource: item.locResource || item.itemId,
    rawChars: raw.length,
    cleanChars: clean.length,
    acceptedPassages: accepted,
    rejected,
    status: accepted.length > 0 ? 'ready' : 'blocked',
    reason: accepted.length > 0 ? null : 'no accepted passages after length/content policy checks',
  };
}
async function existingDbState(client) {
  const [idsRes, titlesRes] = await Promise.all([client.execute('SELECT id FROM passages'), client.execute('SELECT DISTINCT book_title FROM passages')]);
  return { ids: new Set(idsRes.rows.map((r) => String(r.id))), titles: new Set(titlesRes.rows.map((r) => normalizeTitle(r.book_title))) };
}
function rowsForItem(itemResult, existingIds, seenIds) {
  const rows = [];
  const failures = [];
  for (const text of itemResult.acceptedPassages) {
    const id = sha256Hex(`loc-selected-digitized-books\n${itemResult.filename}\n${text}`).slice(0, 16);
    if (existingIds.has(id) || seenIds.has(id)) { failures.push({ id, reason: 'duplicate-id' }); continue; }
    seenIds.add(id);
    rows.push({ id, text, book_title: itemResult.title, author: itemResult.author, chapter: `Library of Congress OCR: ${itemResult.filename}`, tags: '[]', language: 'en', sourceUrl: itemResult.sourceUrl, locResource: itemResult.locResource, charCount: text.length });
  }
  return { rows, failures };
}
function escapeMd(value) { return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 160); }
function markdownReport({ itemResults, rows, failures, inserted, blockedReason }) {
  const lines = ['# PLANET-3882 — LOC reviewed ingest report', '', `Generated: ${new Date().toISOString()}`, '', '## Summary', '', `- Mode: ${apply ? 'apply' : 'dry-run'}`, `- Reviewed LOC files evaluated: ${itemResults.length}`, `- Candidate rows accepted by policy: ${rows.length}`, `- Expected production insert count: ${apply ? inserted : rows.length}`, `- Rows inserted: ${inserted}`, `- Failures/skips: ${failures.length}`, blockedReason ? `- Apply blocked: ${blockedReason}` : '- Apply blocked: no', '', '## Candidate rows', '', '| # | ID | Title | Author | LOC source | Chars | Preview |', '|---:|---|---|---|---|---:|---|'];
  rows.slice(0, 50).forEach((row, idx) => lines.push(`| ${idx + 1} | ${row.id} | ${escapeMd(row.book_title)} | ${escapeMd(row.author)} | ${escapeMd(row.sourceUrl)} | ${row.charCount} | ${escapeMd(row.text.slice(0, 120))} |`));
  lines.push('', '## Item-level results', '', '| LOC file | Status | Clean chars | Accepted | Rejected/skipped | Notes |', '|---|---|---:|---:|---|---|');
  for (const item of itemResults) {
    const failCount = failures.filter((f) => f.filename === item.filename).length;
    lines.push(`| ${item.filename || 'unknown'} | ${item.status} | ${item.cleanChars || 0} | ${item.acceptedPassages?.length || 0} | ${JSON.stringify(item.rejected || {})}${failCount ? ` + row skips ${failCount}` : ''} | ${escapeMd(item.reason || item.locResource || '')} |`);
  }
  lines.push('', '## Safety', '', '- Reviewed list is explicit and only rows with `reviewed:true` are fetched.', '- Dry-run is default and writes only local report/sample artifacts.', '- Apply requires `--apply --ack-reviewed`, Turso credentials, and rows that pass RandomPage length/content policies.', '- Inserted rows use `tags=[]`; existing tag cron handles later tagging.', '- No summaries, full-reader, social layer, or unreviewed Discover/push exposure are introduced.');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const reviewedItems = loadReviewedItems();
  if (reviewedItems.length === 0) throw new Error('no reviewed LOC items supplied; set reviewed:true in docs/loc-reviewed-items.json after human review');
  if (apply && !ackReviewed) throw new Error('apply blocked: pass --ack-reviewed after confirming the reviewed LOC list and tiny batch');

  const itemResults = [];
  const failures = [];
  for (const item of reviewedItems) {
    try {
      const result = await evaluateReviewedItem(item);
      itemResults.push(result);
      process.stderr.write(`${result.status} ${result.filename}: accepted=${result.acceptedPassages.length} cleanChars=${result.cleanChars}\n`);
    } catch (err) {
      itemResults.push({ filename: item.filename, status: 'blocked', acceptedPassages: [], rejected: {}, reason: err.message });
      failures.push({ filename: item.filename, reason: err.message });
      process.stderr.write(`blocked ${item.filename}: ${err.message}\n`);
    }
    await sleep(750);
  }

  const envLocal = loadEnvLocal();
  const TURSO_URL = process.env.TURSO_DATABASE_URL || envLocal.TURSO_DATABASE_URL;
  const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || envLocal.TURSO_AUTH_TOKEN;
  let db = null;
  let existing = { ids: new Set(), titles: new Set() };
  let blockedReason = null;
  if (TURSO_URL && TURSO_TOKEN) { db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN }); existing = await existingDbState(db); }
  else if (apply) blockedReason = 'TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required for apply';

  const seenIds = new Set();
  const rows = [];
  for (const result of itemResults.filter((r) => r.status === 'ready')) {
    if (existing.titles.has(normalizeTitle(result.title))) { failures.push({ filename: result.filename, reason: 'book-title-already-present' }); continue; }
    const planned = rowsForItem(result, existing.ids, seenIds);
    rows.push(...planned.rows);
    for (const failure of planned.failures) failures.push({ filename: result.filename, ...failure });
  }

  let inserted = 0;
  if (apply && !blockedReason) {
    if (!db) blockedReason = 'database client unavailable';
    else if (rows.length === 0) blockedReason = 'no reviewed candidate rows passed policy/dedupe checks';
    else {
      const sql = 'INSERT INTO passages (id, text, book_title, author, chapter, tags, language) VALUES (?,?,?,?,?,?,?)';
      for (const row of rows) {
        try { await db.execute({ sql, args: [row.id, row.text, row.book_title, row.author, row.chapter, row.tags, row.language] }); inserted += 1; }
        catch (err) { failures.push({ filename: row.chapter, id: row.id, reason: `insert-failed: ${err.message}` }); }
      }
    }
  }

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, markdownReport({ itemResults, rows, failures, inserted, blockedReason }));
  await writeFile(samplesPath, `${JSON.stringify({ mode: apply ? 'apply' : 'dry-run', rows, itemResults, failures, inserted, blockedReason }, null, 2)}\n`);
  if (db) await db.close?.();
  const summary = { mode: apply ? 'apply' : 'dry-run', reviewed_items: itemResults.length, candidate_rows: rows.length, expected_insert_count: apply ? inserted : rows.length, inserted, failures: failures.length, blockedReason, report: path.relative(process.cwd(), reportPath), samples: path.relative(process.cwd(), samplesPath) };
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else console.log(`LOC_REVIEWED_INGEST mode=${summary.mode} reviewed_items=${summary.reviewed_items} candidate_rows=${summary.candidate_rows} expected_insert_count=${summary.expected_insert_count} inserted=${summary.inserted} failures=${summary.failures} report=${summary.report}`);
  if (apply && blockedReason) process.exitCode = 1;
}
main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
