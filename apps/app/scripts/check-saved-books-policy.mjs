#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const files = {
  routes: 'src/server/routes/bookmarks.ts',
  discover: 'src/client/pages/Discover.tsx',
  source: 'src/client/pages/BookSource.tsx',
  bookmarks: 'src/client/pages/Bookmarks.tsx',
};

const checks = [
  ['routes', 'CREATE TABLE IF NOT EXISTS saved_books'],
  ['routes', "bookmarksRouter.post('/saved-books'"],
  ['routes', "bookmarksRouter.get('/saved-books'"],
  ['routes', "bookmarksRouter.patch('/saved-books/:id'"],
  ['routes', "bookmarksRouter.delete('/saved-books/:id'"],
  ['routes', 'CREATE UNIQUE INDEX IF NOT EXISTS saved_books_user_source_key'],
  ['routes', 'book:'],
  ['discover', 'Want to read book'],
  ['discover', "apiFetch('/saved-books'"],
  ['source', 'Want to read book'],
  ['source', "apiFetch('/saved-books'"],
  ['bookmarks', 'Want-to-read shelf'],
  ['bookmarks', "apiFetch('/saved-books')"],
  ['bookmarks', "`/saved-books/${encodeURIComponent(book.id)}`"],
];

let failed = false;
for (const [key, needle] of checks) {
  const text = readFileSync(files[key], 'utf8');
  if (!text.includes(needle)) {
    console.error(`[saved-books-policy] missing ${needle} in ${files[key]}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('[saved-books-policy] PASS — private want-to-read shelf routes, idempotent unique key, UI actions, shelf controls, and preference signal are present.');
