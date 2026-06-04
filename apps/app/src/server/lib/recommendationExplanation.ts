import { parsePassageTags, scorePassageTags } from './passageTags.js';

const HIDDEN_TAGS = new Set(['en', 'zh', 'ja', 'fr', 'de', 'es', 'other']);
const MIN_VISIBLE_WEIGHT = 2;

type PreferenceLike = { tag: string; weight: number };
type PassageLike = { tags: string | null | undefined };

export type RecommendationExplanation = {
  label: 'High match' | 'Good match';
  reason: string;
  matchedTags: string[];
  score: number;
};

function titleTag(tag: string) {
  return tag
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function uniqueVisiblePassageTags(rawTags: string | null | undefined) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const tag of parsePassageTags(rawTags)) {
    const normalized = tag.toLowerCase().trim();
    if (!normalized || HIDDEN_TAGS.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(normalized);
  }
  return tags;
}

export function preferenceMapFromRows(preferences: PreferenceLike[]) {
  return Object.fromEntries(preferences.map((pref) => [pref.tag, Number(pref.weight) || 1]));
}

export function explainRecommendation(
  passage: PassageLike,
  preferences: PreferenceLike[] | Record<string, number>,
): RecommendationExplanation | null {
  const prefMap = Array.isArray(preferences) ? preferenceMapFromRows(preferences) : preferences;
  const rankedMatches = uniqueVisiblePassageTags(passage.tags)
    .map((tag) => ({ tag, weight: Number(prefMap[tag]) || 0 }))
    .filter((match) => match.weight >= MIN_VISIBLE_WEIGHT)
    .sort((a, b) => b.weight - a.weight || a.tag.localeCompare(b.tag))
    .slice(0, 3);

  if (rankedMatches.length === 0) return null;

  const matchedTags = rankedMatches.map((match) => match.tag);
  const score = scorePassageTags(passage.tags, prefMap);
  const label = rankedMatches.some((match) => match.weight >= 7) || score >= 12 ? 'High match' : 'Good match';
  const humanTags = matchedTags.map(titleTag);
  const reason = humanTags.length === 1
    ? `Because you read and save ${humanTags[0]} passages.`
    : `Because you read and save ${humanTags.slice(0, -1).join(', ')} + ${humanTags.at(-1)} passages.`;

  return { label, reason, matchedTags, score };
}
