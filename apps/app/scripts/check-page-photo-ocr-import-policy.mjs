#!/usr/bin/env node
/**
 * Static smoke for PLANET-3501 private page-photo OCR import flow.
 * Verifies the app has a signed-in page photo entry point, preview/accept APIs,
 * fixture-text success path, unreadable failure copy, and public Discover exclusion
 * for private/import-candidate passages.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const files = {
  settings: path.join(root, 'src/client/pages/Settings.tsx'),
  importRoute: path.join(root, 'src/server/routes/import.ts'),
  passagesRoute: path.join(root, 'src/server/routes/passages.ts'),
  pkg: path.join(root, 'package.json'),
};

function read(file) {
  return readFileSync(file, 'utf8');
}

function assertIncludes(name, haystack, needles) {
  for (const needle of needles) {
    if (!haystack.includes(needle)) throw new Error(`${name} missing: ${needle}`);
  }
}

const settings = read(files.settings);
const importRoute = read(files.importRoute);
const passagesRoute = read(files.passagesRoute);
const pkg = read(files.pkg);

assertIncludes('Settings page-photo UI', settings, [
  'Page photo import (private)',
  'type="file"',
  'accept="image/png,image/jpeg,image/webp"',
  '/import/page-photo-ocr/preview',
  '/import/page-photo-ocr/accept',
  'Save to private Bookmarks',
]);

assertIncludes('import route auth/private preview', importRoute, [
  "'/import/page-photo-ocr/preview'",
  "'/import/page-photo-ocr/accept'",
  'verifyBearer',
  'fixtureText',
  'needs_ocr_text',
  'private/import-candidate',
  'saved_private_candidate',
  'Private page-photo OCR import candidate',
]);

assertIncludes('public Discover private exclusion', passagesRoute, [
  'isPublicDiscoverPassage',
  "tags.includes('private')",
  "tags.includes('import-candidate')",
  'filterReadablePassages(allPassages).filter(isPublicDiscoverPassage)',
]);

assertIncludes('package script', pkg, ['check:page-photo-ocr-import']);

console.log('PASS page-photo OCR import policy: private preview/save flow and Discover exclusion are wired.');
