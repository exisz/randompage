#!/usr/bin/env node
/**
 * check-source-policy.mjs — PLANET-2101 / PLANET-2000
 *
 * Regression smoke for known protected/modern-book full-text sources that must
 * not reappear in the RandomPage passage cache. This is intentionally a narrow
 * deny-list guard, not the product's primary content-source strategy.
 *
 * Usage:
 *   pnpm check:source-policy
 *   pnpm check:source-policy -- --json
 *   pnpm check:source-policy -- --apply   # reviewed cleanup only
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

const BLOCKED_SOURCES = [
  {
    title: 'It Ends With Us',
    author: 'Colleen Hoover',
    reason: 'known protected modern-book full text; RandomPage may keep metadata/linkouts only unless explicit reuse permission exists',
  },
];

function parseArgs(argv) {
  const out = {};
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    out[token.slice(2)] = true;
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
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

const args = parseArgs(process.argv.slice(2));
const envLocal = loadEnvLocal();
const TURSO_URL = process.env.TURSO_DATABASE_URL || envLocal.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || envLocal.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error('error: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN required (set in env or apps/app/.env.local)');
  process.exit(1);
}

const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
const violations = [];

for (const source of BLOCKED_SOURCES) {
  const result = await client.execute({
    sql: `SELECT p.id, p.book_title, p.author,
            length(p.text) AS len,
            (SELECT COUNT(*) FROM bookmarks WHERE passage_id = p.id) AS bookmarks,
            (SELECT COUNT(*) FROM push_history WHERE passage_id = p.id) AS push_history
          FROM passages p
          WHERE lower(trim(p.book_title)) = ?
            AND lower(trim(p.author)) = ?
          ORDER BY p.id`,
    args: [normalize(source.title), normalize(source.author)],
  });

  for (const row of result.rows) {
    violations.push({
      id: String(row.id),
      book_title: String(row.book_title || ''),
      author: String(row.author || ''),
      len: Number(row.len || 0),
      bookmarks: Number(row.bookmarks || 0),
      push_history: Number(row.push_history || 0),
      reason: source.reason,
    });
  }
}

const report = {
  checked_sources: BLOCKED_SOURCES.map(({ title, author, reason }) => ({ title, author, reason })),
  violations,
  ok: violations.length === 0,
};

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else if (report.ok) {
  console.log(`[source-policy] ok: checked ${BLOCKED_SOURCES.length} blocked source(s); no known protected full-text passages found`);
} else {
  console.log(`[source-policy] violations: ${violations.length}`);
  for (const row of violations) {
    console.log(`- ${row.id} :: ${row.book_title} — ${row.author} len=${row.len} refs(bookmarks=${row.bookmarks}, push_history=${row.push_history}) :: ${row.reason}`);
  }
}

if (report.ok) process.exit(0);

if (!args.apply) {
  console.error('[source-policy] failed: rerun with --apply only after reviewing rows and confirming deletion is safe');
  process.exit(1);
}

const unsafe = violations.filter((row) => row.bookmarks > 0 || row.push_history > 0);
if (unsafe.length) {
  console.error(`[source-policy] refusing --apply: ${unsafe.length} violation(s) have user references`);
  process.exit(1);
}

const ids = violations.map((row) => row.id);
const placeholders = ids.map(() => '?').join(',');
const deleted = await client.execute({ sql: `DELETE FROM passages WHERE id IN (${placeholders})`, args: ids });
console.log(`[source-policy] deleted protected passage rows: ${deleted.rowsAffected}`);
