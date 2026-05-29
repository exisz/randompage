#!/usr/bin/env node
/**
 * check-tag-failure-policy.mjs — PLANET-2263
 *
 * Reports untagged passages and exhausted passage_tag_failures rows so
 * tag-untagged can be QA'd after partial-failure and requeue repairs.
 *
 * Usage:
 *   pnpm check:tag-failures
 *   pnpm check:tag-failures -- --json --sample 5
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

function preview(text, n = 140) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, n);
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

await client.execute(`
  CREATE TABLE IF NOT EXISTS passage_tag_failures (
    passage_id TEXT PRIMARY KEY NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at TEXT NOT NULL
  )
`);

const countRes = await client.execute(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN p.tags IS NULL OR p.tags = '' OR p.tags = '[]' THEN 1 ELSE 0 END) AS untagged,
    SUM(CASE WHEN (p.tags IS NULL OR p.tags = '' OR p.tags = '[]') AND COALESCE(f.retry_count, 0) >= 3 THEN 1 ELSE 0 END) AS untagged_exhausted,
    (SELECT COUNT(*) FROM passage_tag_failures) AS failure_rows,
    (SELECT COUNT(*) FROM passage_tag_failures WHERE retry_count >= 3) AS exhausted_failure_rows
  FROM passages p
  LEFT JOIN passage_tag_failures f ON f.passage_id = p.id
`);
const counts = countRes.rows[0] || {};

const samplesRes = await client.execute({
  sql: `
    SELECT p.id, p.book_title, p.author, length(p.text) AS len, COALESCE(f.retry_count, 0) AS retry_count, f.last_error, f.updated_at, p.text
    FROM passages p
    LEFT JOIN passage_tag_failures f ON f.passage_id = p.id
    WHERE p.tags IS NULL OR p.tags = '' OR p.tags = '[]'
    ORDER BY COALESCE(f.retry_count, 0) DESC, p.rowid ASC
    LIMIT ?
  `,
  args: [sampleLimit],
});

const report = {
  total: Number(counts.total || 0),
  untagged: Number(counts.untagged || 0),
  untagged_exhausted: Number(counts.untagged_exhausted || 0),
  failure_rows: Number(counts.failure_rows || 0),
  exhausted_failure_rows: Number(counts.exhausted_failure_rows || 0),
  samples: samplesRes.rows.map((row) => ({
    id: String(row.id),
    len: Number(row.len),
    title: String(row.book_title || ''),
    author: String(row.author || ''),
    retry_count: Number(row.retry_count || 0),
    updated_at: row.updated_at == null ? null : String(row.updated_at),
    last_error: row.last_error == null ? null : String(row.last_error).slice(0, 240),
    preview: preview(row.text),
  })),
};

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('tag failure policy: untagged passages must not be silently stranded behind exhausted retry rows');
  console.log(`total=${report.total} untagged=${report.untagged} untagged_exhausted=${report.untagged_exhausted} failure_rows=${report.failure_rows} exhausted_failure_rows=${report.exhausted_failure_rows}`);
  console.log('\nsamples:');
  for (const row of report.samples) {
    console.log(`- ${row.id} len=${row.len} retry=${row.retry_count} ${row.title} — ${row.author}: ${row.preview}`);
    if (row.last_error) console.log(`  error=${row.last_error}`);
  }
}

await client.close?.();

if (args['fail-on-exhausted'] && report.untagged_exhausted > 0) process.exit(1);
