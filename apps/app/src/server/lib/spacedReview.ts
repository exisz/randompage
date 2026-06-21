// Spaced-repetition increasing-interval scheduling for saved-passage review (PLANET-3015).
//
// Readwise-style retention loop adapted to RandomPage's EXISTING saved book passages:
// well-remembered saved passages resurface progressively LESS often (interval lengthens),
// while skipped/forgotten ones come back SOONER (interval shortens). The math here operates
// purely over the existing passage_reviews rows — no new content sources, summaries, or feeds.
//
// A per-bookmark "box" index walks a growing interval ladder. Each consecutive successful
// review advances one box (longer rest); a skip steps the box back down (shorter rest).
// review_later is an explicit "remind me soon" and always returns tomorrow without advancing
// the ladder, matching the existing recall-card affordance.

/** Increasing interval ladder in days. Index = box. Last entry is the hard cap. */
export const INTERVAL_LADDER_DAYS = [1, 3, 7, 14, 30, 60] as const;

/** Highest box index (also the capped interval). */
export const MAX_BOX = INTERVAL_LADDER_DAYS.length - 1;

export type ReviewAction = 'reviewed' | 'skip' | 'review_later';

/** Clamp an arbitrary number to a valid box index within the ladder. */
export function clampBox(box: number): number {
  if (!Number.isFinite(box)) return 0;
  const rounded = Math.round(box);
  if (rounded < 0) return 0;
  if (rounded > MAX_BOX) return MAX_BOX;
  return rounded;
}

/** Days to wait for a given box index (clamped to the ladder, capped at the max). */
export function intervalDaysForBox(box: number): number {
  return INTERVAL_LADDER_DAYS[clampBox(box)];
}

/**
 * Given the box index of the PREVIOUS review (or null for a first review) and the action just
 * taken, compute the next box index.
 *
 * - reviewed     -> advance one box (capped at MAX_BOX): longer interval each consecutive success.
 * - skip         -> step one box back down (floor 0): shorter interval, item returns sooner.
 * - review_later -> stay on the same box (does not advance the ladder); caller still schedules +1 day.
 */
export function nextBox(previousBox: number | null | undefined, action: ReviewAction): number {
  const base = previousBox === null || previousBox === undefined ? -1 : clampBox(previousBox);
  if (action === 'reviewed') {
    // First-ever review (base -1) lands on box 1 (3 days) so a first success already rests
    // a little longer than a fresh/forgotten item; subsequent successes keep climbing.
    return clampBox(base + 1 < 1 ? 1 : base + 1);
  }
  if (action === 'skip') {
    // Forgotten/uninterested: drop a box so it resurfaces sooner. Never below box 0 (1 day).
    return clampBox(base - 1);
  }
  // review_later: keep the same box; the caller pins dueAfter to tomorrow regardless.
  return base < 0 ? 0 : clampBox(base);
}

/** Add whole days to a date in UTC. */
export function addDaysUTC(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export interface ReviewSchedule {
  /** Resulting box index to persist on the new review row. */
  box: number;
  /** Days until the passage is due again. */
  intervalDays: number;
  /** Absolute next-due timestamp. */
  dueAfter: Date;
}

/**
 * Compute the next review schedule for a saved passage.
 *
 * @param previousBox box index from the most recent prior review, or null if never reviewed.
 * @param action      the review outcome the user just chose.
 * @param now         the current time.
 */
export function computeReviewSchedule(
  previousBox: number | null | undefined,
  action: ReviewAction,
  now: Date,
): ReviewSchedule {
  const box = nextBox(previousBox, action);
  // review_later is an explicit short reminder: always tomorrow, no ladder advance.
  const intervalDays = action === 'review_later' ? INTERVAL_LADDER_DAYS[0] : intervalDaysForBox(box);
  return { box, intervalDays, dueAfter: addDaysUTC(now, intervalDays) };
}

/**
 * Backward-compatible box derivation for legacy review rows that predate the box column.
 *
 * Counts the run of consecutive 'reviewed' actions from most-recent backwards (a proxy for the
 * old streak) and maps it onto the ladder, so existing reviewers don't snap back to box 0 after
 * deploy. Rows are expected newest-first.
 */
export function deriveBoxFromHistory(
  history: Array<{ action: string; box?: number | null }>,
): number | null {
  if (!history.length) return null;
  const latest = history[0];
  if (latest.box !== null && latest.box !== undefined && Number.isFinite(latest.box)) {
    return clampBox(latest.box);
  }
  // No persisted box yet: approximate from the consecutive 'reviewed' streak.
  if (latest.action === 'skip') return 0;
  if (latest.action === 'review_later') return 0;
  let streak = 0;
  for (const row of history) {
    if (row.action === 'reviewed') streak += 1;
    else break;
  }
  if (streak <= 0) return null;
  // streak of N consecutive reviews ≈ box N (capped), so the next advance keeps climbing.
  return clampBox(streak);
}
