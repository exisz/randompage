import { buildRelatedSavedPassageQuery, scoreRelatedSavedPassages } from '../src/server/lib/recallSearch.js';

const current = {
  id: 'current-power-page',
  bookmarkId: 'bookmark-current',
  text: 'Power that begins as reform can still decay when no rival voice is allowed to question its command.',
  bookTitle: 'The Republic',
  author: 'Plato',
  tags: JSON.stringify(['power', 'ethics', 'philosophy']),
  note: 'A warning about authority corrupting good intentions.',
  annotations: [{ quote: 'no rival voice', note: 'unchecked power needs resistance' }],
  collections: ['Political philosophy'],
  sources: ['bookmark'],
};

const results = scoreRelatedSavedPassages(current, [
  current,
  {
    id: 'related-power-page',
    bookmarkId: 'bookmark-related',
    text: 'The good ruler must be constrained, because noble motives alone do not prevent cruelty once power answers only to itself.',
    bookTitle: 'Discourses on Power',
    author: 'A. Thinker',
    tags: JSON.stringify(['power', 'ethics', 'leadership']),
    note: 'Power and good intentions are both present here.',
    collections: ['Political philosophy'],
    sources: ['bookmark'],
  },
  {
    id: 'unrelated-garden-page',
    bookmarkId: 'bookmark-unrelated',
    text: 'Morning flowers leaned toward the rain while a small stream crossed the garden path.',
    bookTitle: 'Garden Notes',
    author: 'Anonymous',
    tags: JSON.stringify(['nature', 'beauty']),
    collections: ['Pastoral'],
    sources: ['bookmark'],
  },
], 5);

if (!buildRelatedSavedPassageQuery(current).includes('power')) {
  console.error('Related query must seed from title/tags/note/annotation/excerpt signals.');
  process.exit(1);
}
if (results.some(result => result.id === current.id)) {
  console.error('Related saved pages must exclude the current review passage.', results);
  process.exit(1);
}
if (results[0]?.id !== 'related-power-page') {
  console.error('Related saved pages did not rank the nearest saved passage first.', results);
  process.exit(1);
}
if (results[0]?.bookmarkId !== 'bookmark-related') {
  console.error('Related saved pages must preserve bookmarkId so review actions stay scoped to user-owned saved passages.', results[0]);
  process.exit(1);
}
if (!results[0]?.matchReason.startsWith('Related by')) {
  console.error('Related saved pages should expose a human-readable match reason.', results[0]);
  process.exit(1);
}

console.log('✅ related saved pages rank deterministic user-owned matches and exclude the current passage');
