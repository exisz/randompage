#!/usr/bin/env node
/**
 * openlibrary-ia-candidate-queue.mjs — PLANET-3180
 *
 * Builds a review-first candidate queue from the Open Library Search Inside
 * evaluation artifact. This script stores discovery metadata only: title,
 * author, OLID, IA identifier, topic, source URL, snippets/readability flags,
 * and score. It deliberately does not copy full OCR passage text from the eval
 * candidate section and does not fetch IA OCR/plaintext.
 *
 * The emitted reviewed-items JSON is compatible with ia-ocr-ingest.mjs, but all
 * rows default to reviewed:false. A human-reviewed allowlist must be passed to
 * ia-ocr-ingest before any OCR/plaintext fetch or production import.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const args = parseArgs(process.argv.slice(2));
const sourcePath = path.resolve(APP_ROOT, args.source || 'docs/openlibrary-search-inside-eval-samples.json');
const queuePath = path.resolve(APP_ROOT, args.queue || 'docs/openlibrary-ia-candidate-queue.json');
const reportPath = path.resolve(APP_ROOT, args.report || 'docs/openlibrary-ia-candidate-queue.md');
const reviewedPath = path.resolve(APP_ROOT, args.reviewed || 'docs/openlibrary-ia-reviewed-items.json');
const limit = clampInt(args.limit, 1, 100, 30);
const reviewedIds = new Set(String(args['mark-reviewed'] || '').split(',').map((id) => id.trim()).filter(Boolean));

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

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isDirectOpenCandidate(record) {
  return Boolean(record?.iaIdentifier)
    && record?.readApi?.status === 'open'
    && record?.readApi?.isReadable === true
    && record?.readApi?.isLendable !== true
    && record?.readApi?.availableToBorrow !== true;
}

function scoreRecord(record, candidateByIdentifier) {
  let score = 0;
  if (isDirectOpenCandidate(record)) score += 50;
  if (candidateByIdentifier.has(record.iaIdentifier)) score += 30;
  score += Math.min(10, Math.floor(Number(record.snippetLength || 0) / 80));
  if (record.olid) score += 3;
  if (Number(record.year) && Number(record.year) < 1950) score += 2;
  return score;
}

function compactSnippets(snippets) {
  return (Array.isArray(snippets) ? snippets : [])
    .map((snippet) => normalize(snippet).slice(0, 220))
    .filter(Boolean)
    .slice(0, 2);
}

function buildQueue(evalPayload) {
  const records = Array.isArray(evalPayload.records) ? evalPayload.records : [];
  const candidates = Array.isArray(evalPayload.candidates) ? evalPayload.candidates : [];
  const candidateByIdentifier = new Map(candidates
    .filter((candidate) => candidate?.iaIdentifier)
    .map((candidate) => [candidate.iaIdentifier, candidate]));

  const seen = new Set();
  return records
    .filter(isDirectOpenCandidate)
    .filter((record) => {
      if (seen.has(record.iaIdentifier)) return false;
      seen.add(record.iaIdentifier);
      return true;
    })
    .map((record) => {
      const evalCandidate = candidateByIdentifier.get(record.iaIdentifier);
      return {
        identifier: record.iaIdentifier,
        title: normalize(record.title || evalCandidate?.title || record.iaIdentifier),
        author: normalize(record.author || evalCandidate?.author || 'Unknown'),
        topic: normalize(record.topic || evalCandidate?.topic),
        olid: record.olid || evalCandidate?.olid || null,
        year: record.year || null,
        sourceUrl: record.sourceUrl || evalCandidate?.sourceUrl || `https://archive.org/details/${record.iaIdentifier}`,
        archiveUrl: `https://archive.org/details/${record.iaIdentifier}`,
        snippetLength: Number(record.snippetLength || 0),
        snippets: compactSnippets(record.snippets),
        readApi: record.readApi || null,
        evalTextFetch: evalCandidate ? {
          attempted: true,
          textFile: evalCandidate.textFile || null,
          // No passage text here: this queue is metadata/review only.
          passageCandidateChars: Number(evalCandidate.passage?.length || 0),
        } : { attempted: false },
        score: scoreRecord(record, candidateByIdentifier),
        reviewed: reviewedIds.has(record.iaIdentifier),
        reviewNote: reviewedIds.has(record.iaIdentifier) ? 'explicitly marked reviewed by --mark-reviewed' : 'pending human review before IA OCR fetch',
      };
    })
    .sort((a, b) => b.score - a.score || b.snippetLength - a.snippetLength)
    .slice(0, limit);
}

function reviewedItemsForIngest(queue) {
  return queue.map((item) => ({
    identifier: item.identifier,
    title: item.title,
    author: item.author,
    source: 'openlibrary-search-inside',
    sourceUrl: item.sourceUrl,
    archiveUrl: item.archiveUrl,
    topic: item.topic,
    reviewed: item.reviewed === true,
    reviewNote: item.reviewNote,
  }));
}

function escapeMd(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 180);
}

function markdownReport({ generatedAt, source, queue }) {
  const reviewedCount = queue.filter((item) => item.reviewed).length;
  const rows = queue.map((item, index) => `| ${index + 1} | ${item.reviewed ? 'yes' : 'no'} | ${item.score} | ${escapeMd(item.topic)} | ${escapeMd(item.title)} | ${escapeMd(item.author)} | ${item.identifier} | ${escapeMd(item.sourceUrl)} |`).join('\n');
  return `# Open Library → IA OCR reviewed candidate queue — PLANET-3180

Generated: ${generatedAt}
Source eval artifact: \`${path.relative(APP_ROOT, source)}\`

## Summary

- Candidate queue rows: ${queue.length}
- Human-reviewed rows: ${reviewedCount}
- Default safety posture: rows are \`reviewed:false\` unless explicitly marked with \`--mark-reviewed\` after human review.
- This queue stores metadata/snippets/readability flags only. It does not fetch OCR/plaintext and does not copy full passage candidate text.
- Next reviewed import command, after manually editing \`${path.relative(APP_ROOT, reviewedPath)}\` or using \`--mark-reviewed\` for an explicit allowlist:

\`\`\`bash
pnpm --filter @randompage/app ingest:ia-ocr -- --reviewed docs/openlibrary-ia-reviewed-items.json --max-items 2 --max-passages-per-item 10
\`\`\`

Use \`--apply --ack-reviewed\` only for a tiny reviewed batch after inspecting the dry-run report.

## Queue

| # | reviewed | score | topic | title | author | IA identifier | source |
|---:|---|---:|---|---|---|---|---|
${rows || '| — | — | 0 | — | — | — | — | — |'}

## Boundary

- Search Inside is discovery/ranking only.
- IA OCR/plaintext fetch is gated by the reviewed allowlist consumed by \`ia-ocr-ingest.mjs\`.
- The ingest path reuses RandomPage length/content filters before any row can become a passage.
- No protected full-text cache, summaries, generic reader/feed, or production writes are performed by this queue builder.
`;
}

async function main() {
  if (!existsSync(sourcePath)) throw new Error(`source eval samples not found: ${sourcePath}`);
  const evalPayload = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const generatedAt = new Date().toISOString();
  const queue = buildQueue(evalPayload);
  const payload = {
    generatedAt,
    source: path.relative(APP_ROOT, sourcePath),
    policy: 'metadata-only reviewed candidate queue; no OCR/plaintext fetch; reviewed allowlist required before ia-ocr-ingest',
    queue,
  };

  await mkdir(path.dirname(queuePath), { recursive: true });
  await writeFile(queuePath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(reviewedPath, `${JSON.stringify(reviewedItemsForIngest(queue), null, 2)}\n`);
  await writeFile(reportPath, markdownReport({ generatedAt, source: sourcePath, queue }));

  console.log(JSON.stringify({ queue: path.relative(process.cwd(), queuePath), reviewed: path.relative(process.cwd(), reviewedPath), report: path.relative(process.cwd(), reportPath), candidates: queue.length, reviewedCount: queue.filter((item) => item.reviewed).length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
