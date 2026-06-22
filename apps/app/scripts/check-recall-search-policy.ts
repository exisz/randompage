import { scoreRecallPassages } from '../src/server/lib/recallSearch.js';

const results = scoreRecallPassages('power corrupting good intentions', [
  {
    id: 'intended',
    text: 'A ruler may begin with noble purpose, but unchecked authority slowly bends good intentions toward cruelty.',
    bookTitle: 'The Republic',
    author: 'Plato',
    tags: JSON.stringify(['power', 'ethics', 'leadership']),
    note: 'Power can corrupt even sincere reformers.',
    collections: ['Political philosophy'],
    sources: ['bookmark'],
  },
  {
    id: 'unrelated',
    text: 'The morning garden was bright with dew and birdsong beside the quiet river.',
    bookTitle: 'Pastoral Poems',
    author: 'Anonymous',
    tags: JSON.stringify(['nature', 'beauty']),
    sources: ['history'],
  },
], 5);

if (results[0]?.id !== 'intended') {
  console.error('Recall scorer did not rank the intended saved passage first.', results);
  process.exit(1);
}
if (!results[0].matchedFields.includes('private note') || !results[0].matchedFields.includes('tag')) {
  console.error('Recall scorer must count private notes and tags as match signals.', results[0]);
  process.exit(1);
}

console.log('✅ recall search scorer ranks fuzzy idea matches and uses private notes/tags');
