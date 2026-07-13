#!/usr/bin/env node
/** Static policy guard for PLANET-3696 reviewed IA/OCR passage-yield evaluation. */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(filePath) {
  assert(existsSync(filePath), `missing file: ${path.relative(APP_ROOT, filePath)}`);
  return readFileSync(filePath, 'utf8');
}

const scriptPath = path.join(APP_ROOT, 'scripts/ia-ocr-passage-yield-eval.mjs');
const fixturePath = path.join(APP_ROOT, 'docs/ia-ocr-passage-yield-reviewed-fixture.json');
const packagePath = path.join(APP_ROOT, 'package.json');
const script = read(scriptPath);
const fixture = JSON.parse(read(fixturePath));
const pkg = JSON.parse(read(packagePath));

assert(pkg.scripts['eval:ia-ocr-passage-yield'] === 'node scripts/ia-ocr-passage-yield-eval.mjs', 'package.json must expose eval:ia-ocr-passage-yield');
assert(pkg.scripts['check:ia-ocr-passage-yield'] === 'node scripts/check-ia-ocr-passage-yield-policy.mjs', 'package.json must expose check:ia-ocr-passage-yield');
assert(script.includes('reviewed === true && item.allowOcrFetch === true'), 'eval must require reviewed=true and allowOcrFetch=true before OCR/plaintext fetch');
assert(script.includes('statusCounts') && script.includes('metadata-only') && script.includes('search-inside-snippet-only') && script.includes('ocr-plaintext-usable'), 'eval report must classify metadata-only/snippet-only/usable outcomes');
assert(script.includes('writeFile(reportPath') && script.includes('writeFile(samplesPath'), 'eval must write local report/sample artifacts');
assert(!/createClient|@libsql\/client|TURSO_|\bINSERT\b|\bUPDATE\b|\bDELETE\b/.test(script), 'eval must not include production DB write paths');
assert(Array.isArray(fixture) && fixture.length >= 5, 'fixture must include at least 5 reviewed allowlisted items');
assert(fixture.every((item) => item.reviewed === true && item.allowOcrFetch === true), 'fixture rows must be explicit reviewed allowOcrFetch rows');

console.log('check:ia-ocr-passage-yield PASS');
