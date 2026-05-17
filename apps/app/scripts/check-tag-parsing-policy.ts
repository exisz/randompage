import assert from 'node:assert/strict';
import { parsePassageTags, scorePassageTags } from '../src/server/lib/passageTags.js';

const jsonTags = '["fiction","tense","investigation","mystery","evidence","en"]';
const legacyTags = 'fiction, tense, investigation, mystery, evidence, en';

assert.deepEqual(parsePassageTags(jsonTags), ['fiction', 'tense', 'investigation', 'mystery', 'evidence', 'en']);
assert.deepEqual(parsePassageTags(legacyTags), ['fiction', 'tense', 'investigation', 'mystery', 'evidence', 'en']);

const preferences = { mystery: 8, evidence: 5 };
const jsonScore = scorePassageTags(jsonTags, preferences);
const legacyScore = scorePassageTags(legacyTags, preferences);

assert.equal(jsonScore, legacyScore, 'JSON-array tags must score like legacy comma tags');
assert.equal(jsonScore, 17, 'clean preference keys should influence L1 scoring: 1+1+1+8+5+1');

const bookmarkTags = parsePassageTags(jsonTags);
assert.ok(bookmarkTags.includes('mystery'));
assert.ok(!bookmarkTags.some(tag => tag.includes('[') || tag.includes('"') || tag.includes(']')));

console.log('PASS tag parsing policy: JSON array tags produce clean preference tags and L1 weights');
