import type { Bookmark, Passage, UserPreference } from '../generated/prisma/index.js';
import { CONTROL_TAG_PREFIX } from './preferenceControls.js';
import { parsePassageTags } from './passageTags.js';

export const REVIEW_TUNING_PREFIX = `${CONTROL_TAG_PREFIX}review-tuning:`;
export const REVIEW_TUNING_GLOBAL_TAG = `${REVIEW_TUNING_PREFIX}global`;
export const REVIEW_TUNING_SOURCE_PREFIX = `${REVIEW_TUNING_PREFIX}source:`;
export const REVIEW_TUNING_TAG_PREFIX = `${REVIEW_TUNING_PREFIX}tag:`;

export type ReviewTuningPreset = 'pause' | 'less' | 'normal' | 'more';
export type ReviewTuningScope = 'global' | 'source' | 'tag';

export type ReviewTuningRule = {
  scope: ReviewTuningScope;
  value: string;
  preset: ReviewTuningPreset;
  label: string;
};

export type ReviewTunableBookmark = Bookmark & { passage: Passage; passageReviews?: Array<{ dueAfter: Date; reviewedAt?: Date; action?: string; box?: number | null }> };

const PRESET_TO_WEIGHT: Record<Exclude<ReviewTuningPreset, 'normal'>, number> = {
  pause: -100,
  less: -1,
  more: 2,
};

export function reviewTuningWeight(preset: ReviewTuningPreset) {
  return preset === 'normal' ? 0 : PRESET_TO_WEIGHT[preset];
}

export function reviewTuningPresetFromWeight(weight: number): ReviewTuningPreset {
  if (weight <= -50) return 'pause';
  if (weight < 0) return 'less';
  if (weight > 1) return 'more';
  return 'normal';
}

function encodeValue(value: string) {
  return encodeURIComponent(value.trim());
}

function decodeValue(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function sourceTuningValue(title: string | null | undefined, author: string | null | undefined) {
  return `${String(title || '').trim()}::${String(author || '').trim()}`;
}

export function reviewTuningTag(scope: ReviewTuningScope, value = '') {
  if (scope === 'global') return REVIEW_TUNING_GLOBAL_TAG;
  if (scope === 'source') return `${REVIEW_TUNING_SOURCE_PREFIX}${encodeValue(value)}`;
  return `${REVIEW_TUNING_TAG_PREFIX}${encodeValue(value.toLowerCase())}`;
}

export function parseReviewTuning(preferences: Pick<UserPreference, 'tag' | 'weight'>[]): ReviewTuningRule[] {
  return preferences
    .filter((pref) => pref.tag.startsWith(REVIEW_TUNING_PREFIX))
    .map((pref): ReviewTuningRule | null => {
      const preset = reviewTuningPresetFromWeight(Number(pref.weight) || 0);
      if (pref.tag === REVIEW_TUNING_GLOBAL_TAG) {
        return { scope: 'global', value: '', preset, label: `All saved pages · ${preset}` };
      }
      if (pref.tag.startsWith(REVIEW_TUNING_SOURCE_PREFIX)) {
        const value = decodeValue(pref.tag.slice(REVIEW_TUNING_SOURCE_PREFIX.length));
        const [title, author] = value.split('::');
        const label = [title, author].filter(Boolean).join(' — ') || 'Selected book';
        return { scope: 'source', value, preset, label: `${label} · ${preset}` };
      }
      if (pref.tag.startsWith(REVIEW_TUNING_TAG_PREFIX)) {
        const value = decodeValue(pref.tag.slice(REVIEW_TUNING_TAG_PREFIX.length)).toLowerCase();
        return { scope: 'tag', value, preset, label: `#${value} · ${preset}` };
      }
      return null;
    })
    .filter((rule): rule is ReviewTuningRule => Boolean(rule));
}

export function matchedReviewTuning(bookmark: ReviewTunableBookmark, rules: ReviewTuningRule[]) {
  const sourceValue = sourceTuningValue(bookmark.passage.bookTitle, bookmark.passage.author);
  const tags = new Set(parsePassageTags(bookmark.passage.tags).map((tag) => tag.toLowerCase()));
  return rules.filter((rule) => {
    if (rule.scope === 'global') return true;
    if (rule.scope === 'source') return rule.value === sourceValue;
    return tags.has(rule.value.toLowerCase());
  });
}

export function reviewTuningScore(bookmark: ReviewTunableBookmark, rules: ReviewTuningRule[]) {
  const matched = matchedReviewTuning(bookmark, rules);
  if (matched.some((rule) => rule.preset === 'pause')) {
    return { paused: true, score: -Infinity, reason: 'paused by your review tuning' };
  }
  let score = 1;
  let reason: string | null = null;
  for (const rule of matched) {
    if (rule.preset === 'more') {
      score *= 3;
      reason = `shown more often because ${rule.scope === 'tag' ? `#${rule.value}` : rule.scope === 'source' ? rule.label.replace(/ · more$/, '') : 'saved pages'} is prioritized`;
    } else if (rule.preset === 'less') {
      score *= 0.25;
      if (!reason) reason = `shown less often because ${rule.scope === 'tag' ? `#${rule.value}` : rule.scope === 'source' ? rule.label.replace(/ · less$/, '') : 'saved pages'} is quieted`;
    }
  }
  return { paused: false, score, reason };
}

export function tuneDueBookmarks<T extends ReviewTunableBookmark>(bookmarks: T[], rules: ReviewTuningRule[], now = new Date()) {
  return bookmarks
    .filter((bookmark) => {
      const latest = bookmark.passageReviews?.[0];
      return !latest || latest.dueAfter <= now;
    })
    .map((bookmark, originalIndex) => ({ bookmark, originalIndex, tuning: reviewTuningScore(bookmark, rules) }))
    .filter((item) => !item.tuning.paused)
    .sort((a, b) => b.tuning.score - a.tuning.score || a.originalIndex - b.originalIndex);
}
