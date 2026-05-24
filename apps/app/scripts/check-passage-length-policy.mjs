#!/usr/bin/env node
/**
 * check-passage-length-policy.mjs — PLANET-2037 / PLANET-2054
 *
 * Reports RandomPage corpus fragment length distribution and samples rows outside
 * the quick flip-reading bounds. Optional --repair-plan groups out-of-policy rows
 * by source book and flags user references before any destructive cleanup.
 *
 * Usage:
 *   pnpm check:passage-lengths
 *   pnpm check:passage-lengths -- --json --sample 5
 *   pnpm check:passage-lengths -- --repair-plan
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

const MIN_CHARS = 180;
const TARGET_CHARS = 300;
const MAX_CHARS = 800;

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function preview(text, n = 120) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function asInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
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
  ORDER BY len ASC
`);
const rows = rowsRes.rows.map((row) => ({
  id: String(row.id),
  book_title: String(row.book_title || ''),
  author: String(row.author || ''),
  chapter: row.chapter == null ? null : String(row.chapter),
  text: String(row.text || ''),
  len: Number(row.len),
}));
const lengths = rows.map((row) => row.len).sort((a, b) => a - b);
const shortRows = rows.filter((row) => row.len < MIN_CHARS);
const longRows = rows.filter((row) => row.len > MAX_CHARS).sort((a, b) => b.len - a.len);
const buckets = {
  under_100: rows.filter((row) => row.len < 100).length,
  under_min: shortRows.length,
  target_band_180_800: rows.filter((row) => row.len >= MIN_CHARS && row.len <= MAX_CHARS).length,
  over_max: longRows.length,
  over_1200: rows.filter((row) => row.len > 1200).length,
};
const report = {
  policy: { min_chars: MIN_CHARS, target_chars: TARGET_CHARS, max_chars: MAX_CHARS },
  total: rows.length,
  p50: percentile(lengths, 50),
  p90: percentile(lengths, 90),
  p95: percentile(lengths, 95),
  min: lengths[0] || 0,
  max: lengths[lengths.length - 1] || 0,
  buckets,
  too_short_samples: shortRows.slice(0, sampleLimit).map((row) => ({
    id: row.id,
    len: row.len,
    title: row.book_title,
    author: row.author,
    preview: preview(row.text),
  })),
  too_long_samples: longRows.slice(0, sampleLimit).map((row) => ({
    id: row.id,
    len: row.len,
    title: row.book_title,
    author: row.author,
    preview: preview(row.text),
  })),
};

if (args['repair-plan']) {
  const badIds = [...shortRows, ...longRows].map((row) => row.id);
  const refCounts = new Map();
  if (badIds.length > 0) {
    const quoted = badIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
    const refs = await client.execute(`
      SELECT p.id,
             (SELECT COUNT(*) FROM bookmarks b WHERE b.passage_id = p.id) AS bookmarks,
             (SELECT COUNT(*) FROM push_history ph WHERE ph.passage_id = p.id) AS push_history,
             (SELECT COUNT(*) FROM browsing_events be WHERE be.passage_id = p.id) AS browsing_events
      FROM passages p
      WHERE p.id IN (${quoted})
    `);
    for (const row of refs.rows) {
      refCounts.set(String(row.id), {
        bookmarks: Number(row.bookmarks || 0),
        push_history: Number(row.push_history || 0),
        browsing_events: Number(row.browsing_events || 0),
      });
    }
  }

  const groups = new Map();
  for (const row of [...shortRows, ...longRows]) {
    const key = `${row.book_title} — ${row.author}`;
    const g = groups.get(key) || {
      title: row.book_title,
      author: row.author,
      too_short: 0,
      too_long: 0,
      user_referenced_rows: 0,
      sample_ids: [],
    };
    if (row.len < MIN_CHARS) g.too_short += 1;
    if (row.len > MAX_CHARS) g.too_long += 1;
    const refs = refCounts.get(row.id) || {};
    if ((refs.bookmarks || 0) + (refs.push_history || 0) + (refs.browsing_events || 0) > 0) {
      g.user_referenced_rows += 1;
    }
    if (g.sample_ids.length < sampleLimit) g.sample_ids.push(row.id);
    groups.set(key, g);
  }
  report.repair_plan = {
    action: 'Reslice affected source books with the bounded slicer, insert replacement 180-800 char fragments, then delete only unreferenced out-of-policy rows. Rows with bookmarks/push_history/browsing_events need manual review or history-preserving replacement.',
    affected_books: [...groups.values()].sort((a, b) => (b.too_short + b.too_long) - (a.too_short + a.too_long)),
  };
}

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`passage length policy: target≈${TARGET_CHARS} chars, allowed=${MIN_CHARS}-${MAX_CHARS}`);
  console.log(`total=${report.total} p50=${report.p50} p90=${report.p90} p95=${report.p95} min=${report.min} max=${report.max}`);
  console.log(`under_100=${buckets.under_100} under_min=${buckets.under_min} target_band=${buckets.target_band_180_800} over_max=${buckets.over_max} over_1200=${buckets.over_1200}`);
  console.log('\ntoo-short samples:');
  for (const row of report.too_short_samples) console.log(`- ${row.id} len=${row.len} ${row.title} — ${row.author}: ${row.preview}`);
  console.log('\ntoo-long samples:');
  for (const row of report.too_long_samples) console.log(`- ${row.id} len=${row.len} ${row.title} — ${row.author}: ${row.preview}`);
  if (report.repair_plan) {
    console.log('\nrepair plan:');
    console.log(report.repair_plan.action);
    for (const g of report.repair_plan.affected_books.slice(0, sampleLimit)) {
      console.log(`- ${g.title} — ${g.author}: short=${g.too_short} long=${g.too_long} user_referenced=${g.user_referenced_rows} samples=${g.sample_ids.join(',')}`);
    }
  }
}

await client.close?.();
