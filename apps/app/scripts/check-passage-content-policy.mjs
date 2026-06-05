#!/usr/bin/env node
/**
 * check-passage-content-policy.mjs — PLANET-2139
 *
 * Reports RandomPage corpus rows that look like standalone reference notes,
 * footnotes, table-of-contents/chapter-list fragments, editorial note fragments,
 * or sentence-boundary truncations rather than readable prose.
 *
 * Usage:
 *   pnpm check:passage-content
 *   pnpm check:passage-content -- --json --sample 5
 *
 * Env (read from env or apps/app/.env.local):
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@libsql/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function loadEnvLocal() {
  const envPath = path.join(APP_DIR, '.env.local');
  if (!existsSync(envPath)) return {};
  const text = readFileSync(envPath, 'utf8');
  const out = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

function asInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function preview(text, n = 160) {
  return normalize(text).slice(0, n);
}

function hasTerminalSentencePunctuation(text) {
  const normalized = normalize(text);
  return /[.!?…。！？][\"'”’）)\]》」』]*$/.test(normalized);
}

function detectChapterListFragment(text) {
  const normalized = normalize(text);
  if (!normalized) return false;
  const chapterMatches = normalized.match(/(?:^|[\s.;:!?。！？])(?:chapter|chap\.|book|part|section)\s+(?:[0-9ivxlcdm]+|[a-z][a-z'’-]{1,30})(?=[\s.:;,-])/gi) ?? [];
  if (chapterMatches.length < 4) return false;
  const proseWords = normalized.match(/\b(?:the|and|but|for|with|from|that|this|they|their|there|then|when|where|while|into|upon|because|said|was|were|had|have|will|would|could|should|not)\b/gi) ?? [];
  const proseRatio = proseWords.length / Math.max(1, normalized.split(/\s+/).length);
  return chapterMatches.length >= 6 || proseRatio < 0.18;
}

function detectUnreadablePassageContent(text) {
  const normalized = normalize(text);
  if (!normalized) return null;
  if (normalized.startsWith('↩')) return 'leading-return-marker';
  if (/^(?:note|notes|footnote|footnotes|endnote|endnotes)\s*[:.\-—]/i.test(normalized)) return 'standalone-note-heading';
  if (/^(?:\[[^\]]{1,80}\]|\([^)]{1,80}\))\s*(?:note|footnote|editor|translator|transcriber)/i.test(normalized)) return 'editorial-note-start';
  if (/^(?:for\s+.{1,80},\s*)?(?:see|cf\.)\s+(?:note|notes|footnote|footnotes|endnote|endnotes)\b|^for\s+.{1,80},\s*see\s+(?:note|notes|footnote|footnotes|endnote|endnotes)\b/i.test(normalized)) return 'note-cross-reference-start';
  const markers = normalized.slice(0, 220).match(/(?:↩|\[[0-9ivxlcdm]+\]|\([0-9ivxlcdm]+\)|\^[0-9]+|†|‡)/gi) ?? [];
  if (markers.length >= 3) return 'reference-marker-cluster';
  if (detectChapterListFragment(normalized)) return 'chapter-list-fragment';
  if (!hasTerminalSentencePunctuation(normalized)) return 'non-terminal-ending';
  return null;
}

const args = parseArgs(process.argv.slice(2));
const sampleLimit = asInt(args.sample, 5, 1, 20);
const envLocal = loadEnvLocal();
const TURSO_URL = process.env.TURSO_DATABASE_URL || envLocal.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || envLocal.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error('error: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN required (set in env or apps/app/.env.local)');
  process.exit(1);
}

const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
const rowsRes = await client.execute(`
  SELECT id, book_title, author, chapter, text, length(text) AS len
  FROM passages
  ORDER BY book_title ASC, id ASC
`);
const rows = rowsRes.rows.map((row) => ({
  id: String(row.id),
  book_title: String(row.book_title || ''),
  author: String(row.author || ''),
  chapter: row.chapter == null ? null : String(row.chapter),
  text: String(row.text || ''),
  len: Number(row.len),
}));
const matches = rows
  .map((row) => ({ ...row, reason: detectUnreadablePassageContent(row.text) }))
  .filter((row) => row.reason);

const byReason = matches.reduce((acc, row) => {
  acc[row.reason] = (acc[row.reason] || 0) + 1;
  return acc;
}, {});
const report = {
  policy: {
    rejects: ['leading ↩ return markers', 'standalone note/footnote/endnote headings', 'editorial note starts', 'note cross-reference starts such as “For …, see note …”', 'dense reference-marker clusters in the opening text', 'table-of-contents/chapter-list fragments', 'passages ending without sentence-terminal punctuation'],
  },
  total: rows.length,
  unreadable_content_candidates: matches.length,
  reference_note_candidates: matches.filter((row) => row.reason !== 'non-terminal-ending' && row.reason !== 'chapter-list-fragment').length,
  chapter_list_candidates: matches.filter((row) => row.reason === 'chapter-list-fragment').length,
  non_terminal_ending_candidates: matches.filter((row) => row.reason === 'non-terminal-ending').length,
  by_reason: byReason,
  samples: matches.slice(0, sampleLimit).map((row) => ({
    id: row.id,
    len: row.len,
    title: row.book_title,
    author: row.author,
    reason: row.reason,
    preview: preview(row.text),
  })),
  samples_by_reason: Object.fromEntries(Object.keys(byReason).sort().map((reason) => [
    reason,
    matches.filter((row) => row.reason === reason).slice(0, sampleLimit).map((row) => ({
      id: row.id,
      len: row.len,
      title: row.book_title,
      author: row.author,
      preview: preview(row.text),
    })),
  ])),
};

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('passage content policy: reject standalone reference-note / footnote fragments, chapter-list fragments, and non-terminal endings');
  console.log(`total=${report.total} unreadable_content_candidates=${report.unreadable_content_candidates} reference_note_candidates=${report.reference_note_candidates} chapter_list_candidates=${report.chapter_list_candidates} non_terminal_ending_candidates=${report.non_terminal_ending_candidates}`);
  for (const [reason, count] of Object.entries(byReason)) console.log(`${reason}=${count}`);
  console.log('\nsamples:');
  for (const row of report.samples) console.log(`- ${row.id} len=${row.len} ${row.title} — ${row.author} [${row.reason}]: ${row.preview}`);
  console.log('\nsamples_by_reason:');
  for (const [reason, rows] of Object.entries(report.samples_by_reason)) {
    for (const row of rows) console.log(`- ${reason}: ${row.id} len=${row.len} ${row.title} — ${row.author}: ${row.preview}`);
  }
}

await client.close?.();
