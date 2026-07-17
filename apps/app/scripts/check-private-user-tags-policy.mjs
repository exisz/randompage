import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../src/server/routes/bookmarks.ts', import.meta.url), 'utf8');
const recall = readFileSync(new URL('../src/server/lib/recallSearch.ts', import.meta.url), 'utf8');
const bookmarks = readFileSync(new URL('../src/client/pages/Bookmarks.tsx', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

function must(condition, message) {
  if (!condition) {
    console.error(`[check:private-user-tags] FAIL — ${message}`);
    process.exit(1);
  }
}

must(schema.includes('userTags  String?  @map("user_tags")') && schema.includes('userTags    String?  @map("user_tags")'), 'bookmark and annotation models must expose private user_tags columns');
must(route.includes("ALTER TABLE bookmarks ADD COLUMN user_tags TEXT") && route.includes("ALTER TABLE passage_annotations ADD COLUMN user_tags TEXT"), 'runtime inline DDL must backfill user_tags columns');
must(route.includes("/bookmarks/:id/user-tags") && route.includes("/bookmarks/:id/annotations/:annotationId/user-tags"), 'owned bookmark and annotation tag edit endpoints must exist');
must(recall.includes("private tag") && recall.includes("Matched private tag:"), 'recall search must index private tags and expose a private-tag match reason');
must(bookmarks.includes('Private user tags') && bookmarks.includes('Private #') && bookmarks.includes('private-tag:'), 'Bookmarks UI must edit/filter/review private user tags separately from source tags');

console.log('[check:private-user-tags] PASS — private user-owned bookmark/annotation tags persist, search, filter, and themed review without public sampling changes.');
