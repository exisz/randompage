export interface ReviewSchedulePayload {
  review?: {
    action?: string;
    dueAfter?: string | null;
    box?: number | null;
    intervalDays?: number | null;
  } | null;
}

function pluralize(value: number, unit: string) {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

export function formatNextReviewInterval(dueAfter: string | null | undefined, now = new Date()) {
  if (!dueAfter) return 'later';
  const dueTime = new Date(dueAfter).getTime();
  if (Number.isNaN(dueTime)) return 'later';
  const diffMs = dueTime - now.getTime();
  const days = Math.max(0, Math.round(diffMs / 86_400_000));
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ~${pluralize(days, 'day')}`;
  const weeks = Math.round(days / 7);
  if (weeks < 8) return `in ~${pluralize(weeks, 'week')}`;
  const months = Math.round(days / 30);
  return `in ~${pluralize(months, 'month')}`;
}

export function formatReviewScheduleFeedback(action: 'reviewed' | 'review_later' | 'skip', payload: ReviewSchedulePayload) {
  const label = formatNextReviewInterval(payload.review?.dueAfter);
  if (action === 'reviewed') return `Nice — next review ${label}.`;
  if (action === 'review_later') return `Review later set — back ${label}.`;
  return `Got it — back ${label}.`;
}
