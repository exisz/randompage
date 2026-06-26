#!/usr/bin/env node
/** Static policy guard for PLANET-3180 reviewed Open Library → IA OCR queue. */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const scriptPath = path.join(APP_ROOT, 'scripts/openlibrary-ia-candidate-queue.mjs');
const ingestPath = path.join(APP_ROOT, 'scripts/ia-ocr-ingest.mjs');
const packagePath = path.join(APP_ROOT, 'package.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(filePath) {
  assert(existsSync(filePath), `missing file: ${path.relative(APP_ROOT, filePath)}`);
  return readFileSync(filePath, 'utf8');
}

const script = read(scriptPath);
const ingest = read(ingestPath);
const pkg = JSON.parse(read(packagePath));

assert(pkg.scripts['queue:ol-ia-candidates'] === 'node scripts/openlibrary-ia-candidate-queue.mjs', 'package.json must expose queue:ol-ia-candidates');
assert(pkg.scripts['check:ol-ia-queue'] === 'node scripts/check-openlibrary-ia-queue-policy.mjs', 'package.json must expose check:ol-ia-queue');
assert(script.includes('does not fetch IA OCR/plaintext'), 'queue builder must document no OCR/plaintext fetch boundary');
assert(script.includes('reviewed:false') || script.includes('reviewed: item.reviewed === true'), 'queue builder must emit reviewed allowlist state');
assert(script.includes('passageCandidateChars') && !script.includes('passage: evalCandidate.passage'), 'queue builder must not copy full eval passage text into queue output');
assert(!/fetch\s*\(/.test(script), 'queue builder must not call fetch; Search Inside/IA network access belongs to eval/ingest only');
assert(ingest.includes('if (apply && !ackReviewed)') && ingest.includes('--ack-reviewed'), 'ia-ocr ingest must keep reviewed apply gate');
assert(ingest.includes('reviewed !== false'), 'ia-ocr ingest must filter the explicit reviewed list');

console.log('check:ol-ia-queue PASS');
