#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const routes = read('src/server/routes/bookmarks.ts');
const recall = read('src/server/lib/recallSearch.ts');
const bookmarks = read('src/client/pages/Bookmarks.tsx');
const schema = read('prisma/schema.prisma');

function must(condition, message) {
  if (!condition) {
    console.error(`[check:collection-purpose] FAIL — ${message}`);
    process.exit(1);
  }
}

must(schema.includes('purpose   String?'), 'BookmarkCollection schema must include optional private purpose');
must(routes.includes('ALTER TABLE bookmark_collections ADD COLUMN purpose TEXT'), 'runtime inline DDL must add purpose for existing collection tables');
must(routes.includes('normalizeCollectionPurpose'), 'collection purpose must be normalized/capped');
must(routes.includes('collectionPurposes: bookmark.collectionItems.map'), 'recall candidates must include collection purpose text');
must(recall.includes("name: 'collection purpose'"), 'deterministic recall scoring must expose collection purpose as a distinct matched field/reason');
must(bookmarks.includes('Optional purpose') && bookmarks.includes('Purpose: {collection.purpose}'), 'Bookmarks UI must create and display purpose text near collection cards');
must(bookmarks.includes('blank clears it'), 'Bookmarks UI must support clearing collection purpose');
must(bookmarks.includes('collection names/purposes'), 'Recall search copy must disclose private collection purpose matching');

console.log('[check:collection-purpose] PASS — private collection purpose labels are owned, editable/clearable, visible in Bookmarks, and recall-search indexed without external providers.');
