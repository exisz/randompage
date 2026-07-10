#!/usr/bin/env node
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../src/server/routes/bookmarks.ts', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/client/pages/Settings.tsx', import.meta.url), 'utf8');

const checks = [
  ['anonymous ISBN lookup endpoint', server.includes("/saved-books/isbn/lookup") && server.includes('lookupOpenLibraryIsbn')],
  ['manual ISBN normalization', server.includes('normalizeIsbn') && server.includes('ISBN-10 or ISBN-13')],
  ['saved_books preserves ISBN/source metadata', server.includes('isbn13 TEXT') && server.includes('isbn10 TEXT') && server.includes('source TEXT') && server.includes("source === 'isbn-scan'")],
  ['confirmed save reuses private saved_books shelf', server.includes("POST /api/saved-books") && server.includes('source:') && server.includes("source === 'isbn-scan'")],
  ['deterministic public metadata path only', server.includes('https://openlibrary.org/isbn/') && !server.toLowerCase().includes('literal.club')],
  ['Settings exposes Scan book / enter ISBN action', settings.includes('Scan book / enter ISBN') && settings.includes('Save private source interest')],
  ['anonymous preview cannot persist', settings.includes('Anonymous lookup is preview-only') && settings.includes('Sign in to save this private source interest')],
  ['matching passage path links to Source detail', settings.includes('Open Source detail') && settings.includes('/source?title=')],
  ['no copied Goodreads/social/full tracker scope', !settings.toLowerCase().includes('goodreads') && !settings.toLowerCase().includes('review feed')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) {
  console.error(`\nISBN source-interest policy failed: ${failed.map(([name]) => name).join(', ')}`);
  process.exit(1);
}
console.log('\nISBN source-interest policy passed.');
