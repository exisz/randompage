import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { logtoClient } from '../lib/logto';
import { apiFetch } from '../lib/api';

interface Passage {
  id: string;
  text: string;
  bookTitle: string;
  author: string;
  chapter?: string;
  tags: string;
  language: string;
}

interface ReadingStats {
  todayCount: number;
  streakDays: number;
}

const HIDDEN_TAGS = new Set(['en', 'zh', 'ja', 'fr', 'de', 'es', 'other']);
const SHARE_EXCERPT_LENGTH = 220;

function parsePassageTags(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : (() => {
    const text = raw.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall back to legacy comma-delimited tags below.
    }
    return text.split(',');
  })();

  return values
    .map((tag) => String(tag).trim().replace(/^[\s\[\]"']+|[\s\[\]"']+$/g, ''))
    .filter(Boolean)
    .filter((tag) => !HIDDEN_TAGS.has(tag.toLowerCase()))
    .filter((tag, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === tag.toLowerCase()) === index);
}

function shortExcerpt(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > SHARE_EXCERPT_LENGTH
    ? `${normalized.slice(0, SHARE_EXCERPT_LENGTH).trim()}…`
    : normalized;
}

function passageAccent(tags: string[]) {
  const tagText = tags.join(' ').toLowerCase();
  if (/history|war|politic|power|empire/.test(tagText)) return 'from-amber-300/25 via-stone-900 to-base-200';
  if (/philosophy|psychology|mind|wisdom/.test(tagText)) return 'from-cyan-300/20 via-slate-900 to-base-200';
  if (/romance|love|family|heart/.test(tagText)) return 'from-rose-300/25 via-zinc-900 to-base-200';
  if (/adventure|travel|sea|quest/.test(tagText)) return 'from-emerald-300/20 via-neutral-900 to-base-200';
  return 'from-primary/25 via-base-300 to-base-200';
}

export default function Discover() {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookmarked, setBookmarked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const pushPassageId = searchParams.get('passageId');
  const pushSource = searchParams.get('source');

  const fetchStats = useCallback(async () => {
    try {
      const isAuth = await logtoClient.isAuthenticated();
      if (!isAuth) {
        setStats(null);
        return;
      }
      const res = await apiFetch('/reading/stats');
      if (!res.ok) throw new Error(`Reading stats returned ${res.status}`);
      const data = await res.json();
      setStats({ todayCount: data.todayCount ?? 0, streakDays: data.streakDays ?? 0 });
    } catch (e) {
      console.error(e);
      setStats(null);
    }
  }, []);

  const fetchPassage = useCallback(async (preferUnread = false, skippedPassageId?: string) => {
    setLoading(true);
    setBookmarked(false);
    setShareStatus(null);
    try {
      const isAuth = await logtoClient.isAuthenticated();
      setAuthed(isAuth);
      const params = new URLSearchParams();
      if (preferUnread && isAuth) params.set('preferUnread', '1');
      if (skippedPassageId && isAuth) params.set('skipPassageId', skippedPassageId);
      const query = params.toString() ? `?${params.toString()}` : '';
      let res: Response;
      if (isAuth) {
        res = await apiFetch(`/passages/random${query}`);
      } else {
        res = await fetch(`/api/passages/random${query}`);
      }
      const data = await res.json();
      setPassage(data.passage);
      if (isAuth) void fetchStats();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [fetchStats]);

  const fetchPassageById = useCallback(async (passageId: string, source?: string | null) => {
    setLoading(true);
    setBookmarked(false);
    setShareStatus(null);
    try {
      const isAuth = await logtoClient.isAuthenticated();
      setAuthed(isAuth);
      const params = new URLSearchParams();
      if (source) params.set('source', source);
      const query = params.toString() ? `?${params.toString()}` : '';
      const res = isAuth
        ? await apiFetch(`/passages/${encodeURIComponent(passageId)}${query}`)
        : await fetch(`/api/passages/${encodeURIComponent(passageId)}${query}`);
      if (!res.ok) throw new Error(`Passage ${passageId} returned ${res.status}`);
      const data = await res.json();
      setPassage(data.passage);
      if (isAuth) void fetchStats();
    } catch (e) {
      console.error(e);
      await fetchPassage(true);
    } finally {
      setLoading(false);
    }
  }, [fetchPassage, fetchStats]);

  useEffect(() => {
    if (pushPassageId) {
      void fetchPassageById(pushPassageId, pushSource);
      return;
    }
    void fetchPassage(true);
  }, [fetchPassage, fetchPassageById, pushPassageId, pushSource]);

  const handleBookmark = async () => {
    if (!passage || !authed) return;
    try {
      await apiFetch('/bookmarks', {
        method: 'POST',
        body: JSON.stringify({ passageId: passage.id }),
      });
      setBookmarked(true);
    } catch (e) {
      console.error(e);
    }
  };

  const handleShare = async () => {
    if (!passage) return;
    const url = `${window.location.origin}/discover?passageId=${encodeURIComponent(passage.id)}`;
    const excerpt = shortExcerpt(passage.text);
    const title = `${passage.bookTitle} — ${passage.author}`;
    const text = `“${excerpt}”\n\n— ${passage.bookTitle}, ${passage.author}\nRead it on RandomPage: ${url}`;

    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        setShareStatus('Shared');
        return;
      }
      await navigator.clipboard.writeText(text);
      setShareStatus('Copied passage + link');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      console.error(e);
      setShareStatus('Share failed');
    }
  };

  const tags = parsePassageTags(passage?.tags);
  const accent = passageAccent(tags);

  return (
    <div className="min-h-screen overflow-hidden bg-base-100 text-base-content">
      <div className={`absolute inset-x-0 top-0 h-80 bg-gradient-to-br ${accent} opacity-80 blur-3xl`} />
      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-4 sm:px-6">
        <nav className="navbar mb-4 rounded-[2rem] border border-white/10 bg-base-200/70 shadow-2xl backdrop-blur md:mb-8">
          <div className="flex-1">
            <span className="font-serif text-lg tracking-wide sm:text-xl">📖 RandomPage</span>
          </div>
          <div className="flex-none gap-1 sm:gap-2">
            <Link to="/bookmarks" className="btn btn-ghost btn-xs sm:btn-sm">Shelf</Link>
            <Link to="/history" className="btn btn-ghost btn-xs sm:btn-sm">History</Link>
            <Link to="/settings" className="btn btn-ghost btn-xs sm:btn-sm">Settings</Link>
          </div>
        </nav>

        <main className="grid flex-1 items-center gap-5 lg:grid-cols-[0.85fr_1.15fr]">
          <section className="space-y-4 lg:pb-20">
            <p className="text-xs uppercase tracking-[0.35em] text-primary/80">Daily discovery</p>
            <div>
              <h1 className="font-serif text-4xl leading-tight sm:text-5xl">One page worth keeping.</h1>
              <p className="mt-3 max-w-md text-sm leading-relaxed opacity-70 sm:text-base">
                A personal reading ritual: short literary fragments, weighted by what you read, save, and skip.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {authed ? (
                <>
                  <div className="rounded-3xl border border-white/10 bg-base-200/70 p-4 shadow-xl backdrop-blur">
                    <div className="text-3xl font-semibold">{stats?.todayCount ?? '—'}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.2em] opacity-60">read today</div>
                  </div>
                  <div className="rounded-3xl border border-white/10 bg-base-200/70 p-4 shadow-xl backdrop-blur">
                    <div className="text-3xl font-semibold">{stats?.streakDays ?? '—'}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.2em] opacity-60">day streak</div>
                  </div>
                </>
              ) : (
                <div className="col-span-2 rounded-3xl border border-primary/20 bg-primary/10 p-4 shadow-xl backdrop-blur">
                  <div className="font-semibold">Build your reading streak</div>
                  <p className="mt-1 text-sm opacity-70">Sign in to track passages read today and your daily habit loop.</p>
                  <Link to="/signin" className="btn btn-primary btn-sm mt-3">Sign in</Link>
                </div>
              )}
            </div>
          </section>

          <section className="mx-auto w-full max-w-2xl">
            {loading ? (
              <div className="card min-h-[28rem] border border-white/10 bg-base-200/80 shadow-2xl backdrop-blur">
                <div className="card-body items-center justify-center text-center">
                  <span className="loading loading-spinner loading-lg" />
                  <p className="opacity-60">Finding a passage for you…</p>
                </div>
              </div>
            ) : passage ? (
              <article className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-base-200/90 shadow-2xl backdrop-blur">
                <div className={`absolute inset-x-0 top-0 h-28 bg-gradient-to-r ${accent} opacity-60`} />
                <div className="relative p-5 sm:p-7">
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-primary/80">Today's card</p>
                      <h2 className="mt-2 font-serif text-2xl leading-tight sm:text-3xl">{passage.bookTitle}</h2>
                      <p className="mt-1 text-sm opacity-70">{passage.author}{passage.chapter ? ` · ${passage.chapter}` : ''}</p>
                    </div>
                    <div className="rounded-full border border-white/10 bg-base-100/60 px-3 py-1 text-xs opacity-80">
                      {Math.max(1, Math.round(passage.text.length / 220))} min
                    </div>
                  </div>

                  <blockquote className="relative rounded-[1.5rem] border border-white/10 bg-base-100/55 p-5 font-serif text-lg leading-8 shadow-inner sm:p-6 sm:text-xl sm:leading-9">
                    <span className="absolute -left-1 -top-6 font-serif text-7xl text-primary/25">“</span>
                    <span className="relative">{passage.text}</span>
                  </blockquote>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {tags.slice(0, 5).map(tag => (
                      <span key={tag} className="badge badge-outline border-primary/30 bg-base-100/40 text-xs">{tag}</span>
                    ))}
                  </div>

                  {shareStatus && (
                    <div className="toast toast-top toast-center z-20">
                      <div className={`alert ${shareStatus === 'Share failed' ? 'alert-error' : 'alert-success'} py-2 text-sm`}>
                        <span>{shareStatus}</span>
                      </div>
                    </div>
                  )}

                  <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                    <button
                      className="btn btn-primary btn-lg rounded-2xl"
                      onClick={() => fetchPassage(false, passage.id)}
                    >
                      Next passage →
                    </button>
                    <button className="btn btn-outline rounded-2xl" onClick={handleShare}>
                      Share
                    </button>
                    {authed ? (
                      <button
                        className={`btn rounded-2xl ${bookmarked ? 'btn-success' : 'btn-ghost'}`}
                        onClick={handleBookmark}
                        disabled={bookmarked}
                      >
                        {bookmarked ? '✓ Saved' : 'Bookmark'}
                      </button>
                    ) : (
                      <Link to="/signin" className="btn btn-ghost rounded-2xl opacity-70">
                        Sign in to save
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            ) : (
              <div className="alert alert-warning">No passages found.</div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
