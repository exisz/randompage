import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { logtoClient } from '../lib/logto';

type InsightEntry = { label: string; count: number };
type InsightPassage = {
  id: string;
  bookTitle: string;
  author: string;
  chapter: string | null;
  tags: string[];
  snippet: string;
  reason: string;
};
type InsightWindow = {
  days: 7 | 30;
  hasActivity: boolean;
  summary: string;
  metrics: {
    pagesOpened: number;
    viewEvents: number;
    pushedPagesRead: number;
    pushedPagesDelivered: number;
    savedPassages: number;
    reviewedPassages: number;
    activeReadingPaths: number;
  };
  topBooks: InsightEntry[];
  topAuthors: InsightEntry[];
  topTags: InsightEntry[];
  recentlyDiscoveredSources: Array<{ bookTitle: string; author: string; firstSeenAt: string }>;
  activePaths: string[];
  positivePreferences: Array<{ tag: string; weight: number }>;
  revisitNext: InsightPassage[];
  emptyState: string | null;
};

type InsightsResponse = {
  title: string;
  generatedAt: string;
  privacy: string;
  windows: InsightWindow[];
};

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm">
      <div className="text-2xl font-semibold text-primary">{value}</div>
      <div className="text-xs uppercase tracking-[0.2em] text-base-content/55">{label}</div>
    </div>
  );
}

function EntryList({ title, entries }: { title: string; entries: InsightEntry[] }) {
  return (
    <section className="rounded-3xl border border-base-300 bg-base-100 p-5 shadow-sm">
      <h3 className="font-serif text-lg font-semibold">{title}</h3>
      {entries.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {entries.map((entry) => (
            <span key={entry.label} className="badge badge-outline gap-1 py-3">
              {entry.label} <span className="opacity-60">×{entry.count}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-base-content/60">No signal yet.</p>
      )}
    </section>
  );
}

function WindowPanel({ window }: { window: InsightWindow }) {
  return (
    <article className="space-y-5 rounded-[2rem] border border-base-300 bg-base-200/60 p-5 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Last {window.days} days</p>
        <h2 className="mt-1 font-serif text-2xl font-bold">Your private passage pattern</h2>
        <p className="mt-2 text-sm text-base-content/70">{window.summary}</p>
        {window.emptyState && <p className="mt-3 rounded-2xl bg-base-100 p-3 text-sm text-base-content/70">{window.emptyState}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="pages opened" value={window.metrics.pagesOpened} />
        <Metric label="saved" value={window.metrics.savedPassages} />
        <Metric label="reviewed" value={window.metrics.reviewedPassages} />
        <Metric label="push reads" value={window.metrics.pushedPagesRead} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <EntryList title="Top books" entries={window.topBooks} />
        <EntryList title="Top authors" entries={window.topAuthors} />
        <EntryList title="Top tags" entries={window.topTags} />
      </div>

      <section className="rounded-3xl border border-base-300 bg-base-100 p-5 shadow-sm">
        <h3 className="font-serif text-lg font-semibold">Recently discovered sources</h3>
        {window.recentlyDiscoveredSources.length ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {window.recentlyDiscoveredSources.map((source) => (
              <Link
                key={`${source.bookTitle}:${source.author}`}
                className="rounded-2xl border border-base-300 p-3 transition hover:border-primary hover:bg-primary/5"
                to={`/source?title=${encodeURIComponent(source.bookTitle)}&author=${encodeURIComponent(source.author)}`}
              >
                <div className="font-medium">{source.bookTitle}</div>
                <div className="text-sm text-base-content/60">{source.author}</div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-base-content/60">Open a few passages to build this list.</p>
        )}
      </section>

      <section className="rounded-3xl border border-primary/20 bg-primary/5 p-5">
        <h3 className="font-serif text-lg font-semibold">What to revisit next</h3>
        {window.revisitNext.length ? (
          <div className="mt-3 grid gap-3">
            {window.revisitNext.map((passage) => (
              <Link key={passage.id} to={`/discover?passageId=${encodeURIComponent(passage.id)}`} className="rounded-2xl bg-base-100 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="font-medium">{passage.bookTitle}</div>
                <div className="text-sm text-base-content/60">{passage.author}{passage.chapter ? ` · ${passage.chapter}` : ''}</div>
                <p className="mt-2 line-clamp-2 text-sm text-base-content/70">{passage.snippet}</p>
                <p className="mt-2 text-xs font-medium text-primary">{passage.reason}</p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-base-content/60">Save or open pushed pages and RandomPage will suggest 3–5 owned passages here.</p>
        )}
      </section>
    </article>
  );
}

export default function Insights() {
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    logtoClient.isAuthenticated().then(async (isAuthed) => {
      if (cancelled) return;
      setAuthed(isAuthed);
      if (!isAuthed) {
        setLoading(false);
        return;
      }
      try {
        const res = await apiFetch('/reading/insights-wrapup');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load insights');
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  if (!authed && !loading) {
    return (
      <main className="min-h-screen bg-base-200 p-4">
        <div className="mx-auto max-w-3xl rounded-[2rem] bg-base-100 p-6 shadow-sm">
          <h1 className="font-serif text-3xl font-bold">Private reading insights</h1>
          <p className="mt-2 text-base-content/70">Sign in to see a private 7/30-day wrap-up from your own RandomPage activity.</p>
          <Link className="btn btn-primary mt-5" to="/signin">Sign in</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-base-200 p-4 pb-24">
      <div className="mx-auto max-w-5xl space-y-6">
        <nav className="flex items-center justify-between">
          <Link to="/settings" className="btn btn-ghost btn-sm">← Settings</Link>
          <Link to="/history" className="btn btn-ghost btn-sm">History</Link>
        </nav>
        <header className="rounded-[2rem] bg-gradient-to-br from-primary/15 via-base-100 to-secondary/10 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Insights / Wrap-up</p>
          <h1 className="mt-2 font-serif text-4xl font-bold">What RandomPage helped you discover</h1>
          <p className="mt-3 max-w-3xl text-base-content/70">A deterministic, private reading reflection from existing passages, pushes, saves, reviews, paths, and preferences — no summaries, no social comparison, no external LLM.</p>
          {data && <p className="mt-3 text-xs text-base-content/50">Generated {new Date(data.generatedAt).toLocaleString()} · {data.privacy}</p>}
        </header>

        {loading && <div className="alert">Loading your private wrap-up…</div>}
        {error && <div className="alert alert-error">{error}</div>}
        {data?.windows.map((window) => <WindowPanel key={window.days} window={window} />)}
      </div>
    </main>
  );
}
