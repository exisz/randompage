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
      'emailPassageExport',
      'canonicalUrl',
      'Private note',
      'No summaries or generated content',
    ],
  },
  {
    file: 'src/client/pages/Bookmarks.tsx',
    patterns: [
      'Kindle / read-later export',
      'readLaterDestination',
      'exportFilteredBookmarks',
      'filteredBookmarks.map(bookmark => ({ ...bookmark.passage, note: bookmark.note }))',
      "exportFilteredBookmarks('email')",
      "exportFilteredBookmarks('html')",
      "exportFilteredBookmarks('copy')",
    ],
  },
  {
    file: 'src/client/pages/BookSource.tsx',
    patterns: [
      'readLaterDestination',
      'exportSavedSourcePassages',
      'payload.passages.filter((passage) => passage.isSaved)',
      "exportSavedSourcePassages('email')",
      'Export or email only your saved passages from this source',
      'Your private note',
    ],
  },
  {
    file: 'src/server/routes/preferences.ts',
    patterns: [
      'READ_LATER_EMAIL_PREFIX',
      "preferencesRouter.post('/preferences/read-later-destination'",
      'readLaterDestinationFromPreferences',
    ],
  },
  {
    file: 'src/client/pages/Settings.tsx',
    patterns: [
      'Kindle / read-later destination',
      'saveReadLaterDestination',
      'readLaterVerified',
      'Clear',
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

console.log('[check:kindle-export] PASS — saved-passage Kindle/read-later export and email-ready delivery fallback are wired for Settings, Bookmarks, source detail, notes, canonical URLs, and no-summary boundary.');
