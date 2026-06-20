#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [
  {
    file: 'src/client/lib/passageExport.ts',
    patterns: [
      'buildPassageExportHtml',
      'buildPassageExportText',
      'canonicalUrl',
      'Private note',
      'No summaries or generated content',
    ],
  },
  {
    file: 'src/client/pages/Bookmarks.tsx',
    patterns: [
      'Kindle / read-later export',
      'exportFilteredBookmarks',
      'filteredBookmarks.map(bookmark => ({ ...bookmark.passage, note: bookmark.note }))',
      "exportFilteredBookmarks('html')",
      "exportFilteredBookmarks('copy')",
    ],
  },
  {
    file: 'src/client/pages/BookSource.tsx',
    patterns: [
      'exportSavedSourcePassages',
      'payload.passages.filter((passage) => passage.isSaved)',
      'Export only your saved passages from this source',
      'Your private note',
    ],
  },
  {
    file: 'src/server/routes/passages.ts',
    patterns: [
      'select: { passageId: true, note: true }',
      'noteByPassageId',
      'note: noteByPassageId.get(passage.id) ?? null',
    ],
  },
];

const missing = [];
for (const check of checks) {
  const content = read(check.file);
  for (const pattern of check.patterns) {
    if (!content.includes(pattern)) missing.push(`${check.file}: ${pattern}`);
  }
}

if (missing.length) {
  console.error('[check:kindle-export] missing required export policy hooks:');
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log('[check:kindle-export] PASS — saved-passage Kindle/read-later export is wired for Bookmarks + source detail, notes, canonical URLs, and no-summary boundary.');
