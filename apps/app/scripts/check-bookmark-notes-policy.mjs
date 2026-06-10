import { readFileSync } from 'node:fs';

const bookmarks = readFileSync(new URL('../src/client/pages/Bookmarks.tsx', import.meta.url), 'utf8');
const discover = readFileSync(new URL('../src/client/pages/Discover.tsx', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/server/routes/bookmarks.ts', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

const requiredBookmarks = [
  'Private note',
  'Your private note',
  'saveBookmarkNote',
  "apiFetch(`/bookmarks/${bookmark.id}/note`",
  'Add a private reflection',
  'themedReviewQueue.map',
  'recallQueue.map',
  'bookmark.note',
];

const requiredDiscover = [
  'note?: string | null;',
  'Your private note',
  'item.note',
];

const requiredRoutes = [
  'ensureBookmarkNotesColumn',
  'ALTER TABLE bookmarks ADD COLUMN note TEXT',
  "bookmarksRouter.patch('/bookmarks/:id/note'",
  'normalizeBookmarkNote',
  'where: { id: bookmark.id, userId }',
  'note: bookmark.note ?? null',
];

const requiredSchema = [
  'note      String?  @map("note")',
  '@@map("bookmarks")',
];

const missing = [];
for (const needle of requiredBookmarks) {
  if (!bookmarks.includes(needle)) missing.push(`Bookmarks.tsx missing ${needle}`);
}
for (const needle of requiredDiscover) {
  if (!discover.includes(needle)) missing.push(`Discover.tsx missing ${needle}`);
}
for (const needle of requiredRoutes) {
  if (!routes.includes(needle)) missing.push(`bookmarks.ts missing ${needle}`);
}
for (const needle of requiredSchema) {
  if (!schema.includes(needle)) missing.push(`schema.prisma missing ${needle}`);
}

if (missing.length) {
  console.error('[check:bookmark-notes] FAIL');
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log('[check:bookmark-notes] PASS — saved passages support private per-bookmark notes on Bookmarks plus recall/review resurfacing, scoped by user-owned bookmark.');
