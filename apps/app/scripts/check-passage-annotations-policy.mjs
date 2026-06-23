import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../src/server/routes/bookmarks.ts', import.meta.url), 'utf8');
const bookmarks = readFileSync(new URL('../src/client/pages/Bookmarks.tsx', import.meta.url), 'utf8');
const recall = readFileSync(new URL('../src/server/lib/recallSearch.ts', import.meta.url), 'utf8');

function must(condition, message) {
  if (!condition) throw new Error(message);
}

must(route.includes('CREATE TABLE IF NOT EXISTS passage_annotations'), 'passage_annotations table must be created inline');
must(route.includes("where: { id: req.params.id, userId }, include: { passage: true }"), 'create endpoint must load only an owned bookmark with passage');
must(route.includes("where: { id: req.params.annotationId, userId, bookmarkId: bookmark.id }"), 'edit/delete endpoints must be scoped by userId + bookmarkId');
must(route.includes('validateAnnotationAnchor(bookmark.passage.text'), 'annotation create must validate offsets against the saved passage text');
must(route.includes("quote.trim()) return { error: 'quote must match the selected passage text range' }"), 'annotation quote must match selected text range');
must(route.includes('normalizeAnnotationText(req.body?.quote, 600)'), 'quote length must be capped');
must(route.includes('normalizeAnnotationText(req.body?.note, 1200)'), 'note length must be capped');
must(bookmarks.includes('onMouseUp={() => captureThoughtSelection(bm)}'), 'Bookmarks UI must capture text selection on saved passage text');
must(bookmarks.includes('Add thought'), 'Bookmarks UI must expose Add thought affordance');
must(bookmarks.includes('Line-level thoughts'), 'Bookmarks UI must render saved annotation chips');
must(bookmarks.includes(`/bookmarks/${'${bookmark.id}'}/annotations/${'${annotation.id}'}`), 'Bookmarks UI must edit/delete individual annotations');
must(recall.includes('line-level thought'), 'Recall search must index annotation quote/note text');

console.log('✅ passage annotations policy: private line-level thoughts are owned, anchored, capped, editable, and recall-search indexed');
