import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { logtoClient } from '../lib/logto';
import BookSourceLink from '../components/BookSourceLink';

type Passage = {
  id: string;
  text: string;
  bookTitle: string;
  author: string;
  chapter?: string;
  tags: string;
  language: string;
};

type RecommendationExplanation = {
  label: 'High match' | 'Good match';
  reason: string;
  matchedTags: string[];
  score: number;
};

type PushHistoryItem = {
  id: string;
  sentAt: string;
  readAt: string | null;
  passage: Passage;
  whyPersonalized?: RecommendationExplanation | null;
};

type DailyQueueItem = Passage & {
  queuePosition: number;
  whyPersonalized?: RecommendationExplanation | null;
};

type TodaySource = 'latest_push' | 'daily_queue' | 'anonymous';

type TodayState = {
  source: TodaySource;
  passage: Passage | null;
  sentAt?: string;
  whyPersonalized?: RecommendationExplanation | null;
};

const HIDDEN_TAGS = new Set(['en', 'zh', 'ja', 'fr', 'de', 'es', 'other']);

function parseTags(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : (() => {
    const text = raw.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall back to legacy comma-delimited tags.
    }
    return text.split(',');
  })();

  return values
    .map(tag => String(tag).trim().replace(/^[\s\[\]"']+|[\s\[\]"']+$/g, ''))
    .filter(Boolean)
    .filter(tag => !HIDDEN_TAGS.has(tag.toLowerCase()))
    .filter((tag, index, all) => all.findIndex(candidate => candidate.toLowerCase() === tag.toLowerCase()) === index);
}

function shortExcerpt(text: string, length = 520) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length).trim()}…` : normalized;
}

function formatDeliveryTime(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function passageAccent(tags: string[]) {
  const text = tags.join(' ').toLowerCase();
  if (/history|war|politic|power|empire|society/.test(text)) return 'from-amber-300/30 via-stone-950 to-base-200';
  if (/philosophy|psychology|mind|wisdom|contemplative/.test(text)) return 'from-cyan-300/25 via-slate-950 to-base-200';
  if (/romance|love|family|heart|suffering/.test(text)) return 'from-rose-300/25 via-zinc-950 to-base-200';
  if (/adventure|travel|sea|quest|nature/.test(text)) return 'from-emerald-300/25 via-neutral-950 to-base-200';
  return 'from-primary/25 via-base-300 to-base-200';
}

export default function Today() {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<TodayState>({ source: 'anonymous', passage: null });
  const [error, setError] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const isAuth = await logtoClient.isAuthenticated();
      setAuthed(isAuth);
      if (!isAuth) {
        setToday({ source: 'anonymous', passage: null });
        return;
      }

      const [pushResponse, queueResponse] = await Promise.all([
        apiFetch('/push/history'),
        apiFetch('/passages/daily-queue?limit=3'),
      ]);

      if (!pushResponse.ok && !queueResponse.ok) {
        throw new Error(`Could not load Today (${pushResponse.status}/${queueResponse.status})`);
      }

      const pushData = pushResponse.ok ? await pushResponse.json() as { history?: PushHistoryItem[] } : { history: [] };
      const latestPush = Array.isArray(pushData.history) ? pushData.history[0] : null;
      if (latestPush?.passage) {
        setToday({
          source: 'latest_push',
          passage: latestPush.passage,
          sentAt: latestPush.sentAt,
          whyPersonalized: latestPush.whyPersonalized ?? null,
        });
        return;
      }

      const queueData = queueResponse.ok ? await queueResponse.json() as { queue?: DailyQueueItem[] } : { queue: [] };
      const firstDaily = Array.isArray(queueData.queue) ? queueData.queue[0] : null;
      setToday({
        source: 'daily_queue',
        passage: firstDaily ?? null,
        whyPersonalized: firstDaily?.whyPersonalized ?? null,
      });
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
      setToday({ source: 'anonymous', passage: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  const tags = useMemo(() => parseTags(today.passage?.tags), [today.passage?.tags]);
  const accent = passageAccent(tags);
  const deliveredAt = formatDeliveryTime(today.sentAt);

  return (
    <div className="min-h-screen overflow-hidden bg-base-100 text-base-content">
      <div className={`absolute inset-x-0 top-0 h-[34rem] bg-gradient-to-br ${accent} opacity-85 blur-3xl`} />
      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-4 sm:px-6">
        <nav className="navbar mb-4 rounded-[2rem] border border-white/10 bg-base-200/70 shadow-2xl backdrop-blur">
          <div className="flex-1">
            <Link to="/discover" className="font-serif text-lg tracking-wide sm:text-xl">📖 RandomPage</Link>
          </div>
          <div className="flex-none gap-1 sm:gap-2">
            <Link to="/discover" className="btn btn-ghost btn-xs sm:btn-sm">Discover</Link>
            <Link to="/history?tab=push" className="btn btn-ghost btn-xs sm:btn-sm">Inbox</Link>
            <Link to="/settings" className="btn btn-ghost btn-xs sm:btn-sm">Settings</Link>
          </div>
        </nav>

        <main className="flex flex-1 items-center py-4">
          <section className="w-full">
            <div className="mb-5 text-center">
              <p className="text-xs uppercase tracking-[0.38em] text-primary/80">Today shortcut</p>
              <h1 className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">A page waiting on your home screen.</h1>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed opacity-70">
                Open this lightweight PWA surface like a widget: your latest delivered passage first, then today&apos;s personalized queue.
              </p>
            </div>

            {loading ? (
              <div className="card min-h-[26rem] border border-white/10 bg-base-200/80 shadow-2xl backdrop-blur">
                <div className="card-body items-center justify-center text-center">
                  <span className="loading loading-spinner loading-lg" />
                  <p className="opacity-60">Loading today&apos;s passage…</p>
                </div>
              </div>
            ) : !authed ? (
              <div className="overflow-hidden rounded-[2rem] border border-primary/25 bg-base-200/85 shadow-2xl backdrop-blur">
                <div className="p-6 text-center sm:p-8">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/15 text-3xl">☀️</div>
                  <h2 className="font-serif text-3xl">Make Today personal</h2>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed opacity-70">
                    Sign in to show your latest pushed passage or today&apos;s weighted recommendation here. Until then, RandomPage won&apos;t pretend this is personalized.
                  </p>
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <Link to="/signin" className="btn btn-primary rounded-2xl">Sign in</Link>
                    <Link to="/discover" className="btn btn-outline rounded-2xl">Continue to Discover</Link>
                  </div>
                </div>
              </div>
            ) : today.passage ? (
              <article className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-base-200/90 shadow-2xl backdrop-blur">
                <div className={`absolute inset-x-0 top-0 h-32 bg-gradient-to-r ${accent} opacity-65`} />
                <div className="relative p-5 sm:p-8">
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-primary/80">
                        {today.source === 'latest_push' ? 'Latest pushed page' : 'Today\'s personalized page'}
                      </p>
                      <BookSourceLink bookTitle={today.passage.bookTitle} author={today.passage.author} chapter={today.passage.chapter} className="mt-2 text-3xl leading-tight sm:text-4xl" />
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="badge badge-primary badge-outline">{Math.max(1, Math.round(today.passage.text.length / 220))} min</span>
                      {deliveredAt && <span className="text-xs opacity-60">Delivered {deliveredAt}</span>}
                    </div>
                  </div>

                  <blockquote className="relative rounded-[1.5rem] border border-white/10 bg-base-100/60 p-5 font-serif text-lg leading-8 shadow-inner sm:p-6 sm:text-xl sm:leading-9">
                    <span className="absolute -left-1 -top-6 font-serif text-7xl text-primary/25">“</span>
                    <span className="relative">{shortExcerpt(today.passage.text)}</span>
                  </blockquote>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {tags.slice(0, 6).map(tag => (
                      <span key={tag} className="badge badge-outline border-primary/30 bg-base-100/40 text-xs">{tag}</span>
                    ))}
                  </div>

                  {today.whyPersonalized ? (
                    <div className="mt-4 rounded-2xl border border-primary/25 bg-primary/10 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="badge badge-primary badge-outline">{today.whyPersonalized.label}</span>
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/80">Why this page?</span>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed opacity-80">{today.whyPersonalized.reason}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {today.whyPersonalized.matchedTags.slice(0, 3).map(tag => (
                          <span key={tag} className="badge badge-ghost badge-xs">#{tag}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-base-100/35 p-3 text-sm opacity-70">
                      Personalization will appear here after you choose reading goals or save/read more passages.
                    </div>
                  )}

                  <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <Link to={`/discover?passageId=${encodeURIComponent(today.passage.id)}`} className="btn btn-primary btn-lg rounded-2xl">
                      Open full card
                    </Link>
                    <Link to="/history?tab=push" className="btn btn-outline rounded-2xl">
                      Push inbox
                    </Link>
                    <button className="btn btn-ghost rounded-2xl" onClick={() => void loadToday()}>
                      Refresh
                    </button>
                  </div>
                </div>
              </article>
            ) : (
              <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-base-200/85 shadow-2xl backdrop-blur">
                <div className="p-6 text-center sm:p-8">
                  <h2 className="font-serif text-3xl">No personal passage yet</h2>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed opacity-70">
                    Enable daily push or choose reading goals so Today can reuse your user-owned recommendation data instead of showing a broadcast random page.
                  </p>
                  {error && <div className="alert alert-warning mt-4 text-left text-sm"><span>{error}</span></div>}
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <Link to="/settings" className="btn btn-primary rounded-2xl">Set reading goals</Link>
                    <Link to="/discover" className="btn btn-outline rounded-2xl">Open Discover</Link>
                  </div>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
