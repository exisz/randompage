#!/usr/bin/env node
import { readFileSync } from 'node:fs';

function must(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

const bookmarks = readFileSync(new URL('../src/server/routes/bookmarks.ts', import.meta.url), 'utf8');
const push = readFileSync(new URL('../src/server/routes/push.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/client/pages/Bookmarks.tsx', import.meta.url), 'utf8');

must(bookmarks.includes("SOURCE_NOTICE_PREFIX = 'control:source-notify:'"), 'source notices are stored as private user_preferences control rows');
must(bookmarks.includes("/saved-books/:id/notifications"), 'saved-books notification toggle endpoint exists');
must(bookmarks.includes("/saved-books/notices"), 'private saved-book notices endpoint exists');
must(bookmarks.includes('NOT EXISTS (SELECT 1 FROM push_history'), 'notices exclude passages already delivered to that user');
must(push.includes("/push/source-notices"), 'push helper exists for saved book/source notices');
must(push.includes('await prisma.pushHistory.create'), 'source notice push records user-specific push_history');
must(push.includes('x-push-secret'), 'source notice push helper is secret protected');
must(ui.includes('Notify on new pages') && ui.includes('New matching page available'), 'Bookmarks UI exposes toggle and private notice surface');
must(!push.includes('library-card') && !bookmarks.includes('holds/borrowing'), 'implementation avoids Libby loans/holds/library-card mechanics');

if (process.exitCode) process.exit(process.exitCode);
console.log('Source notices policy check passed.');
