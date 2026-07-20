#!/usr/bin/env node
/**
 * loc-reviewed-queue.mjs — PLANET-3882
 *
 * Builds a metadata-only, review-first queue for Library of Congress Selected
 * Digitized Books .txt rows. It never fetches/copies full text and never writes
 * production data. Rows default reviewed:false; humans/QA can explicitly mark a
 * tiny allowlist reviewed before loc-reviewed-ingest.mjs may fetch text.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const DATA_BASE_URL = 'https://data.labs.loc.gov/digitized-books/';
const MANIFEST_URL = `${DATA_BASE_URL}manifest.txt`;
const USER_AGENT = 'RandomPage/1.0 LOC reviewed queue (metadata only; contact gotexis+claw@gmail.com)';

const args = parseArgs(process.argv.slice(2));
const sourcePath = path.resolve(APP_ROOT, args.source || 'docs/loc-digitized-books-eval-samples.json');
const queuePath = path.resolve(APP_ROOT, args.queue || 'docs/loc-reviewed-candidate-queue.json');
const reviewedPath = path.resolve(APP_ROOT, args.reviewed || 'docs/loc-reviewed-items.json');
const reportPath = path.resolve(APP_ROOT, args.report || 'docs/loc-reviewed-candidate-queue.md');
const limit = clampInt(args.limit, 1, 100, 30);
const maxManifestRows = clampInt(args['max-manifest-rows'], 20, 5000, 300);
const markReviewed = new Set(String(args['mark-reviewed'] || '').split(',').map((s) => s.trim()).filter(Boolean));

function parseArgs(argv) {
  const parsed = {};
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
function normalize(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function escapeMd(value) { return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 180); }
async function fetchText(url) {
  const res = await fetch(url, { headers: { accept: 'text/plain,*/*', 'user-agent': USER_AGENT }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.text();
}
function parseManifestRows(text) {
  const rows = [];
  for (const rawLine of text.split('\n')) {
    const [filename, itemId, md5, sizeRaw, objectKey] = rawLine.trim().split('\t');
    if (!filename || !filename.endsWith('.txt')) continue;
    const url = objectKey?.startsWith('http') ? objectKey : `https://${objectKey}`;
    rows.push({ filename, itemId, md5, size: Number(sizeRaw) || 0, objectKey, textUrl: url });
    if (rows.length >= maxManifestRows) break;
  }
  return rows;
}
function rowsFromEval(payload) {
  const byFilename = new Map();
  for (const row of Array.isArray(payload.results) ? payload.results : []) {
    if (!row?.filename || !row?.url) continue;
    byFilename.set(row.filename, {
      filename: row.filename,
      itemId: row.itemId,
      md5: row.md5 || null,
      size: Number(row.size) || 0,
      textUrl: row.url,
      title: normalize(row.metadata?.title),
      author: normalize(row.metadata?.author || 'Unknown'),
      date: row.metadata?.date || null,
      subjects: Array.isArray(row.metadata?.subjects) ? row.metadata.subjects.slice(0, 8) : [],
      language: row.metadata?.language || 'english',
      locResource: row.metadata?.locResource || row.itemId || null,
      candidateCount: Number(row.candidateCount) || 0,
      evalTextFetchSuccess: row.success === true,
    });
  }
  return [...byFilename.values()];
}
function scoreRow(row) {
  let score = 0;
  if (row.evalTextFetchSuccess) score += 30;
  if (row.title) score += 10;
  if (row.author && row.author !== 'Unknown') score += 5;
  score += Math.min(25, Math.floor((row.candidateCount || 0) / 5));
  score += Math.min(10, Math.floor((row.size || 0) / 50000));
  return score;
}
function queueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => row.filename && row.textUrl && !seen.has(row.filename) && seen.add(row.filename))
    .map((row) => ({
      source: 'loc-selected-digitized-books',
      filename: row.filename,
      itemId: row.itemId,
      md5: row.md5 || null,
      size: row.size || 0,
      textUrl: row.textUrl,
      locResource: row.locResource || row.itemId,
      title: normalize(row.title || row.filename.replace(/\.txt$/i, '')),
      author: normalize(row.author || 'Unknown'),
      date: row.date || null,
      subjects: row.subjects || [],
      language: row.language || 'english',
      candidateCount: row.candidateCount || null,
      score: scoreRow(row),
      reviewed: markReviewed.has(row.filename) || markReviewed.has(row.itemId),
      reviewNote: markReviewed.has(row.filename) || markReviewed.has(row.itemId) ? 'explicitly marked reviewed by --mark-reviewed' : 'pending human review before LOC text fetch',
    }))
    .sort((a, b) => b.score - a.score || b.size - a.size)
    .slice(0, limit);
}
function reviewedItems(queue) {
  return queue.map((item) => ({
    source: item.source,
    filename: item.filename,
    itemId: item.itemId,
    textUrl: item.textUrl,
    locResource: item.locResource,
    title: item.title,
    author: item.author,
    date: item.date,
    subjects: item.subjects,
    language: item.language,
    reviewed: item.reviewed === true,
    reviewNote: item.reviewNote,
  }));
}
function markdown({ generatedAt, sourceLabel, queue }) {
  const rows = queue.map((item, i) => `| ${i + 1} | ${item.reviewed ? 'yes' : 'no'} | ${item.score} | ${escapeMd(item.title)} | ${escapeMd(item.author)} | ${item.filename} | ${escapeMd(item.locResource)} |`).join('\n');
  return `# LOC Selected Digitized Books reviewed candidate queue — PLANET-3882\n\nGenerated: ${generatedAt}\nSource: ${sourceLabel}\n\n## Summary\n\n- Candidate queue rows: ${queue.length}\n- Human-reviewed rows: ${queue.filter((item) => item.reviewed).length}\n- Default safety posture: rows are \`reviewed:false\` unless explicitly marked after human review.\n- This queue stores LOC metadata only. It does not fetch OCR/plaintext, copy passage text, or write production data.\n- Next dry-run command after reviewing/editing \`${path.relative(APP_ROOT, reviewedPath)}\`:\n\n\`\`\`bash\npnpm --filter @randompage/app ingest:loc-reviewed -- --reviewed docs/loc-reviewed-items.json --max-items 1 --max-passages-per-item 10\n\`\`\`\n\nUse \`--apply --ack-reviewed\` only for a tiny reviewed batch after inspecting dry-run artifacts.\n\n## Queue\n\n| # | reviewed | score | title | author | LOC filename | source |\n|---:|---|---:|---|---|---|---|\n${rows || '| — | — | 0 | — | — | — | — |'}\n\n## Boundary\n\n- RandomPage remains a personalized book-passage discovery engine.\n- Production ingest is gated by explicit reviewed input plus apply/ack flags in the ingest script.\n- No summaries, full-reader, social feed, or direct unreviewed Discover/push exposure are introduced.\n`;
}

async function main() {
  let rawRows = [];
  let sourceLabel = path.relative(APP_ROOT, sourcePath);
  if (existsSync(sourcePath)) rawRows = rowsFromEval(JSON.parse(readFileSync(sourcePath, 'utf8')));
  if (rawRows.length === 0 || args.manifest) {
    sourceLabel = MANIFEST_URL;
    rawRows = parseManifestRows(await fetchText(MANIFEST_URL));
  }
  const generatedAt = new Date().toISOString();
  const queue = queueRows(rawRows);
  await mkdir(path.dirname(queuePath), { recursive: true });
  await writeFile(queuePath, `${JSON.stringify({ generatedAt, source: sourceLabel, policy: 'metadata-only LOC reviewed queue; text fetch/apply requires reviewed allowlist and loc-reviewed-ingest gate', queue }, null, 2)}\n`);
  await writeFile(reviewedPath, `${JSON.stringify(reviewedItems(queue), null, 2)}\n`);
  await writeFile(reportPath, markdown({ generatedAt, sourceLabel, queue }));
  console.log(JSON.stringify({ queue: path.relative(process.cwd(), queuePath), reviewed: path.relative(process.cwd(), reviewedPath), report: path.relative(process.cwd(), reportPath), candidates: queue.length, reviewedCount: queue.filter((item) => item.reviewed).length }, null, 2));
}
main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
