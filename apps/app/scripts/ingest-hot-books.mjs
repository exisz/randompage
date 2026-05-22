#!/usr/bin/env node
/**
 * ingest-hot-books.mjs — PLANET-1991
 *
 * End-to-end local cron orchestrator for RandomPage v2 passage ingestion:
 *   rank-hot-books → fetch-by-metadata (bookworm) → slice-epub → Turso passages
 *
 * Must run locally (Mac mini) because bookworm CLI needs a Telegram user
 * session and writes to /Volumes/4t/bookworm/. Vercel serverless can't reach
 * either. Vercel cron jobs (e.g. /api/cron/daily-push) are untouched.
 *
 * Usage:
 *   node apps/app/scripts/ingest-hot-books.mjs \
 *     [--limit 20] [--lang en,zh] [--dry-run] \
 *     [--max-passages 50] [--max-per-book 10]
 *
 * Env (read from apps/app/.env.local relative to repo root):
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@libsql/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.resolve(__dirname, '..');
const SCRIPTS_DIR = __dirname;

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
const limit = clampInt(args.limit, 1, 200, 20);
const lang = String(args.lang || 'en');
const dryRun = Boolean(args['dry-run']);
const maxPassages = clampInt(args['max-passages'], 1, 1000, 50);
const maxPerBook = clampInt(args['max-per-book'], 1, 20, 10);

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// ---------- env loader ----------
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

const envLocal = loadEnvLocal();
const TURSO_URL = process.env.TURSO_DATABASE_URL || envLocal.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || envLocal.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error(
    'error: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN required (set in env or apps/app/.env.local)',
  );
  process.exit(1);
}

// ---------- helpers ----------
function nowIso() {
  return new Date().toISOString();
}

function logStderr(msg) {
  process.stderr.write(`[ingest ${nowIso()}] ${msg}\n`);
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const BOILERPLATE_RE =
  /bestselling author|all rights reserved|first published|copyright ©|^isbn|library of congress|cataloging-in-publication|reprinted by/i;

function isBoilerplate(text) {
  if (!text) return true;
  return BOILERPLATE_RE.test(text);
}

function spawnCollect(cmd, argList, { stdinData } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argList, { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: stderr + `\nspawn error: ${err.message}` });
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (stdinData != null) {
      child.stdin.write(stdinData);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

function parseJsonl(text) {
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch (err) {
      logStderr(`warn: skipping bad JSONL line (${err.message}): ${t.slice(0, 120)}`);
    }
  }
  return out;
}

// ---------- main ----------
async function main() {
  const t0 = Date.now();
  const stats = {
    books_ranked: 0,
    candidates: 0,
    dedupe_skipped_books: 0,
    books_fetched_ok: 0,
    passages_emitted: 0,
    passages_dup_skipped: 0,
    passages_boilerplate_skipped: 0,
    passages_inserted: 0,
  };

  // Step 1: rank (request 2x because Zlib hit rate ~30%)
  const rankLimit = limit * 2;
  logStderr(`step 1: ranking top ${rankLimit} books (lang=${lang})`);
  const rankRes = await spawnCollect('node', [
    path.join(SCRIPTS_DIR, 'rank-hot-books.mjs'),
    '--limit',
    String(rankLimit),
    '--lang',
    lang,
  ]);
  if (rankRes.code !== 0) {
    logStderr(`rank-hot-books stderr: ${rankRes.stderr.slice(0, 500)}`);
    console.error('error: rank-hot-books failed');
    process.exit(1);
  }
  let ranked;
  try {
    ranked = JSON.parse(rankRes.stdout);
  } catch (err) {
    console.error(`error: cannot parse rank-hot-books output: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(ranked) || ranked.length === 0) {
    console.error('error: rank-hot-books returned empty list');
    process.exit(1);
  }
  stats.books_ranked = ranked.length;
  stats.candidates = ranked.length;
  logStderr(`ranked ${ranked.length} books`);

  // Step 2: connect Turso, fetch existing titles + passage ids
  logStderr(`step 2: connecting Turso ${TURSO_URL.slice(0, 30)}...`);
  const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  const existingTitlesRes = await turso.execute('SELECT book_title FROM passages');
  const existingTitles = new Set(
    existingTitlesRes.rows.map((r) => normalizeTitle(r.book_title)),
  );
  const existingIdsRes = await turso.execute('SELECT id FROM passages');
  const existingIds = new Set(existingIdsRes.rows.map((r) => String(r.id)));
  logStderr(
    `turso: ${existingTitlesRes.rows.length} existing passages (${existingTitles.size} unique titles, ${existingIds.size} unique ids)`,
  );

  // Step 3: filter ranked by title-dedup, take top limit
  const filtered = [];
  for (const book of ranked) {
    const norm = normalizeTitle(book.title);
    if (norm && existingTitles.has(norm)) {
      stats.dedupe_skipped_books += 1;
      continue;
    }
    filtered.push(book);
    if (filtered.length >= limit) break;
  }
  logStderr(
    `filtered: ${filtered.length} books to fetch (dedupe_skipped=${stats.dedupe_skipped_books})`,
  );
  if (filtered.length === 0) {
    logStderr('nothing to fetch — emitting summary and exiting');
    emitSummary(stats, t0);
    return;
  }

  // Step 4: write JSON to temp and pipe through fetch-by-metadata
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'randompage-ingest-'));
  const inputJsonPath = path.join(tmpDir, `books-${Date.now()}.json`);
  writeFileSync(inputJsonPath, JSON.stringify(filtered));
  logStderr(`step 4: fetching epubs via bookworm (input=${inputJsonPath})`);

  const fetchRes = await spawnCollect('node', [
    path.join(SCRIPTS_DIR, 'fetch-by-metadata.mjs'),
    '--input',
    inputJsonPath,
  ]);
  if (fetchRes.code !== 0) {
    logStderr(
      `fetch-by-metadata exit=${fetchRes.code} stderr=${fetchRes.stderr.slice(0, 800)}`,
    );
  }
  const fetchRecords = parseJsonl(fetchRes.stdout);
  const okRecords = fetchRecords.filter((r) => r && r.status === 'ok' && r.local_path);
  stats.books_fetched_ok = okRecords.length;
  logStderr(
    `fetch: ${fetchRecords.length} records, ${okRecords.length} ok with local_path`,
  );

  // Step 5: slice each
  const allPassages = [];
  for (const rec of okRecords) {
    if (allPassages.length >= maxPassages) break;
    const localPath = rec.local_path;
    if (!existsSync(localPath)) {
      logStderr(`warn: local_path missing: ${localPath}`);
      continue;
    }
    const sliceArgs = [
      path.join(SCRIPTS_DIR, 'slice-epub.mjs'),
      '--input',
      localPath,
      '--max-per-book',
      String(maxPerBook),
    ];
    if (rec.openlib_id) {
      sliceArgs.push('--openlib-id', String(rec.openlib_id));
    }
    const sliceRes = await spawnCollect('node', sliceArgs);
    if (sliceRes.code !== 0) {
      logStderr(
        `warn: slice-epub failed for ${localPath} exit=${sliceRes.code} stderr=${sliceRes.stderr.slice(0, 200)}`,
      );
      continue;
    }
    const passages = parseJsonl(sliceRes.stdout);
    // Inject fallback book_title/author from rec if slice didn't have it
    for (const p of passages) {
      if (!p.book_title) p.book_title = rec.title || '';
      if (!p.book_authors || p.book_authors.length === 0) {
        p.book_authors = rec.authors || [];
      }
    }
    logStderr(`slice: ${path.basename(localPath)} → ${passages.length} passages`);
    for (const p of passages) {
      if (allPassages.length >= maxPassages) break;
      allPassages.push(p);
    }
  }
  stats.passages_emitted = allPassages.length;
  logStderr(`emitted ${allPassages.length} passages (cap=${maxPassages})`);

  // Step 6: dedup against existing ids + boilerplate filter
  const toInsert = [];
  const seenIds = new Set();
  for (const p of allPassages) {
    const text = String(p.text || '').trim();
    if (!text) continue;
    const id = sha256Hex(text).slice(0, 16);
    if (existingIds.has(id) || seenIds.has(id)) {
      stats.passages_dup_skipped += 1;
      continue;
    }
    if (isBoilerplate(text)) {
      stats.passages_boilerplate_skipped += 1;
      continue;
    }
    seenIds.add(id);

    const bookTitle = String(p.book_title || '').trim() || 'Unknown';
    const authorList = Array.isArray(p.book_authors) ? p.book_authors : [];
    const author = String(authorList[0] || '').trim() || 'Unknown';
    const chapter =
      String(p.chapter_title || '').trim() ||
      (Number.isFinite(p.chapter_index) ? `Chapter ${p.chapter_index}` : null);
    const language = p.language === 'chi' ? 'zh' : 'en';

    toInsert.push({
      id,
      text,
      book_title: bookTitle,
      author,
      chapter,
      tags: '[]',
      language,
    });
  }
  logStderr(
    `prepared ${toInsert.length} rows to insert (dup_skipped=${stats.passages_dup_skipped}, boilerplate_skipped=${stats.passages_boilerplate_skipped})`,
  );

  // Step 7: insert (or dry-run plan)
  if (dryRun) {
    const plan = {
      mode: 'dry-run',
      stats,
      would_insert: toInsert.slice(0, 20).map((r) => ({
        id: r.id,
        book_title: r.book_title,
        author: r.author,
        chapter: r.chapter,
        language: r.language,
        text_preview: r.text.slice(0, 100),
      })),
      would_insert_count: toInsert.length,
    };
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
    emitSummary(stats, t0);
    return;
  }

  if (toInsert.length > 0) {
    const sql =
      'INSERT INTO passages (id, text, book_title, author, chapter, tags, language) VALUES (?,?,?,?,?,?,?)';
    const batchStmts = toInsert.map((r) => ({
      sql,
      args: [r.id, r.text, r.book_title, r.author, r.chapter, r.tags, r.language],
    }));
    try {
      await turso.batch(batchStmts, 'write');
      stats.passages_inserted = toInsert.length;
      logStderr(`inserted ${toInsert.length} passages`);
    } catch (err) {
      logStderr(`error: batch insert failed: ${err.message}`);
      // try one-by-one to salvage what we can
      for (const r of toInsert) {
        try {
          await turso.execute({ sql, args: [r.id, r.text, r.book_title, r.author, r.chapter, r.tags, r.language] });
          stats.passages_inserted += 1;
        } catch (e) {
          logStderr(`warn: insert ${r.id} failed: ${e.message}`);
        }
      }
    }
  }

  emitSummary(stats, t0);
}

function emitSummary(stats, t0) {
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const line =
    `summary: books_ranked=${stats.books_ranked} candidates=${stats.candidates} ` +
    `dedupe_skipped_books=${stats.dedupe_skipped_books} books_fetched_ok=${stats.books_fetched_ok} ` +
    `passages_emitted=${stats.passages_emitted} passages_dup_skipped=${stats.passages_dup_skipped} ` +
    `passages_boilerplate_skipped=${stats.passages_boilerplate_skipped} ` +
    `passages_inserted=${stats.passages_inserted} elapsed_s=${elapsed}`;
  process.stderr.write(line + '\n');
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exit(1);
});
