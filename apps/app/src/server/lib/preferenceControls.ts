import type { UserPreference } from '../generated/prisma/index.js';
import { parsePassageTags, scorePassageTags } from './passageTags.js';

export const AVOID_TAG_PREFIX = 'avoid:';
export const CONTROL_TAG_PREFIX = 'control:';
export const AVOID_TAG_WEIGHT = -8;

export type PreferenceLike = Pick<UserPreference, 'tag' | 'weight'>;

export function normalizeAvoidTag(tag: string) {
  return tag.toLowerCase().trim().replace(/^avoid:/, '');
}

export function avoidPreferenceTag(tag: string) {
  return `${AVOID_TAG_PREFIX}${normalizeAvoidTag(tag)}`;
}

export function splitPreferenceControls(preferences: PreferenceLike[]) {
  const positivePreferences = preferences.filter((pref) => !pref.tag.startsWith(AVOID_TAG_PREFIX) && !pref.tag.startsWith(CONTROL_TAG_PREFIX));
  const avoidTags = preferences
    .filter((pref) => pref.tag.startsWith(AVOID_TAG_PREFIX) && Number(pref.weight) < 0)
    .map((pref) => normalizeAvoidTag(pref.tag))
    .filter(Boolean);

  return {
    positivePreferences,
    avoidTags: Array.from(new Set(avoidTags)).sort(),
  };
}

export function preferenceMapWithoutAvoids(preferences: PreferenceLike[]) {
  return Object.fromEntries(
    splitPreferenceControls(preferences).positivePreferences.map((pref) => [pref.tag, Number(pref.weight) || 1]),
  );
}

export function passageAvoidMatches(rawTags: string | null | undefined, avoidTags: Iterable<string>) {
  const avoidSet = new Set(Array.from(avoidTags, normalizeAvoidTag));
  if (avoidSet.size === 0) return [];
  return parsePassageTags(rawTags)
    .map((tag) => tag.toLowerCase().trim())
    .filter((tag) => avoidSet.has(tag));
}

export function scorePassageTagsWithAvoidance(
  rawTags: string | null | undefined,
  positivePreferences: Record<string, number>,
  avoidTags: Iterable<string>,
) {
  const baseScore = scorePassageTags(rawTags, positivePreferences);
  const matchedAvoidTags = passageAvoidMatches(rawTags, avoidTags);
  if (matchedAvoidTags.length === 0) return baseScore;

  // "Avoid for now" is intentionally a soft down-rank, not a hard safety/content filter.
  // Multiple avoided moods compound, while still keeping a non-zero fallback if the corpus is small.
  return Math.max(0.2, baseScore * Math.pow(0.15, matchedAvoidTags.length));
}
