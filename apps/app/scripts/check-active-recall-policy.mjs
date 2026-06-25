import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../src/server/routes/bookmarks.ts', import.meta.url), 'utf8');
const bookmarks = readFileSync(new URL('../src/client/pages/Bookmarks.tsx', import.meta.url), 'utf8');
const blueprint = readFileSync(new URL('../../../BLUEPRINT.md', import.meta.url), 'utf8');

function must(condition, message) {
  if (!condition) throw new Error(message);
}

must(route.includes('CREATE TABLE IF NOT EXISTS passage_recall_cards'), 'active recall cards table must be created inline');
must(route.includes('CREATE TABLE IF NOT EXISTS passage_recall_reviews'), 'active recall reviews table must record private grading events');
must(route.includes("where: { id: req.params.id, userId }, include: { passage: true }"), 'card creation must load only an owned saved bookmark with passage');
must(route.includes('validateAnnotationAnchor(bookmark.passage.text'), 'card creation must validate quote offsets against the saved passage text');
must(route.includes("JOIN bookmarks b ON b.id = c.bookmark_id AND b.user_id = c.user_id"), 'due card query must remain scoped to owned bookmarks');
must(route.includes('normalizeRecallReviewAction'), 'review endpoint must normalize bounded recall grading actions');
must(route.includes('computeRecallReviewSchedule'), 'review endpoint must schedule by active-recall result');
must(route.includes("action === 'remembered' ? 'reviewed'"), 'remembered active recall must advance using spaced-review direction');
must(route.includes("action === 'later' ? 'review_later' : 'skip'"), 'forgot/soon active recall must come back sooner');
must(bookmarks.includes('Make recall card'), 'Bookmarks UI must create cloze cards from selected saved passage text');
must(bookmarks.includes('Active Recall Mastery'), 'Bookmarks UI must expose a Recall Practice surface');
must(bookmarks.includes('hidden phrase'), 'Practice UI must hide the selected phrase before reveal');
must(bookmarks.includes("reviewActiveRecallCard(card.id, 'remembered')"), 'Practice UI must record remembered recall results');
must(bookmarks.includes("reviewActiveRecallCard(card.id, 'forgot')"), 'Practice UI must record forgotten recall results');
must(bookmarks.includes('Open passage'), 'Practice UI must link back to the original saved passage after reveal');
must(blueprint.includes('Active Recall Mastery'), 'BLUEPRINT must document active recall mastery cards');

console.log('✅ active recall policy: private cloze cards are owned, anchored, hidden before reveal, graded, scheduled, and documented');
