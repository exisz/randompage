import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';

type FeedbackAction = 'more_like_this' | 'less_like_this' | 'too_dense' | 'different_topic';
type FeedbackSource = 'discover' | 'push_inbox';

const FEEDBACK_OPTIONS: Array<{ action: FeedbackAction; label: string; detail: string }> = [
  { action: 'more_like_this', label: 'More like this', detail: 'Boost this passage’s tags.' },
  { action: 'less_like_this', label: 'Less like this', detail: 'Down-rank these tags.' },
  { action: 'too_dense', label: 'Too dense / not now', detail: 'Record the signal without hiding saved content.' },
  { action: 'different_topic', label: 'Different topic', detail: 'Nudge recommendations away from this topic.' },
];

interface PassageFeedbackChipsProps {
  passageId?: string | null;
  source?: FeedbackSource;
  authed?: boolean;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  onFeedback?: (action: FeedbackAction) => void;
}

export default function PassageFeedbackChips({
  passageId,
  source = 'discover',
  authed = true,
  disabled = false,
  compact = false,
  className = '',
  onFeedback,
}: PassageFeedbackChipsProps) {
  const [pending, setPending] = useState<FeedbackAction | null>(null);
  const [submitted, setSubmitted] = useState<FeedbackAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!passageId) return null;

  if (!authed) {
    return (
      <div className={`rounded-2xl border border-primary/15 bg-base-100/45 p-3 ${className}`}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/80">Tune your feed</p>
        <p className="mt-1 text-xs opacity-65">Sign in to teach RandomPage what to show more or less often.</p>
        <Link to="/signin" className="btn btn-ghost btn-xs mt-2 rounded-xl">Sign in for feedback chips</Link>
      </div>
    );
  }

  const recordFeedback = async (action: FeedbackAction) => {
    if (pending || submitted || disabled) return;
    setPending(action);
    setError(null);
    try {
      const res = await apiFetch(`/passages/${encodeURIComponent(passageId)}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ action, source }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Feedback returned ${res.status}`);
      }
      setSubmitted(action);
      onFeedback?.(action);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Could not save feedback.');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className={`rounded-2xl border border-primary/15 bg-base-100/45 p-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/80">Tune your feed</p>
        {submitted && <span className="badge badge-success badge-sm">Recorded</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {FEEDBACK_OPTIONS.map((option) => (
          <button
            key={option.action}
            type="button"
            className={`btn rounded-full ${compact ? 'btn-xs' : 'btn-sm'} ${submitted === option.action ? 'btn-success' : 'btn-outline border-primary/25 bg-base-200/40'}`}
            title={option.detail}
            disabled={disabled || Boolean(pending) || Boolean(submitted)}
            onClick={() => recordFeedback(option.action)}
          >
            {pending === option.action ? <span className="loading loading-spinner loading-xs" /> : null}
            {option.label}
          </button>
        ))}
      </div>
      {disabled && <p className="mt-2 text-xs opacity-60">Reconnect to save feedback.</p>}
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
      {!compact && !submitted && <p className="mt-2 text-xs opacity-55">Your tap updates this passage’s event trail and bounded tag weights.</p>}
    </div>
  );
}
