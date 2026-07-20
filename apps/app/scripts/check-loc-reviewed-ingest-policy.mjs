#!/usr/bin/env node
/** Static guard for PLANET-3882 LOC reviewed ingest boundary. */
import { readFileSync } from 'node:fs';

const queue = readFileSync(new URL('./loc-reviewed-queue.mjs', import.meta.url), 'utf8');
const ingest = readFileSync(new URL('./loc-reviewed-ingest.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const checks = [
  ['queue script exists and is metadata-only', queue.includes('metadata only') && queue.includes('reviewed:false') && queue.includes('It does not fetch OCR/plaintext')],
  ['queue emits reviewed allowlist', queue.includes('docs/loc-reviewed-items.json') && queue.includes('reviewedItems(queue)')],
  ['ingest dry-run is default', ingest.includes('Dry-run is default') && ingest.includes('Mode: ${apply ? \'apply\' : \'dry-run\'}')],
  ['apply requires explicit ack-reviewed', ingest.includes('apply && !ackReviewed') && ingest.includes('--ack-reviewed')],
  ['ingest only loads reviewed:true rows', ingest.includes('item.reviewed === true')],
  ['ingest requires Turso credentials for apply', ingest.includes('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required for apply')],
  ['ingest reuses RandomPage length/content guards', ingest.includes('MIN_PASSAGE_CHARS = 180') && ingest.includes('MAX_PASSAGE_CHARS = 800') && ingest.includes('reference-note-or-footnote-fragment') && ingest.includes('chapter-list-fragment')],
  ['production inserts only passages table rows with tags=[]', ingest.includes('INSERT INTO passages') && ingest.includes("tags: '[]'")],
  ['package scripts registered', pkg.scripts['queue:loc-reviewed'] === 'node scripts/loc-reviewed-queue.mjs' && pkg.scripts['ingest:loc-reviewed'] === 'node scripts/loc-reviewed-ingest.mjs'],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log('LOC_REVIEWED_INGEST_POLICY_OK');
