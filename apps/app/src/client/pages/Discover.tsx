import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { logtoClient } from '../lib/logto';
import { apiFetch } from '../lib/api';
import AppShell from '../components/AppShell';

interface Passage {
  id: string;
  text: string;
  bookTitle: string;
  author: string;
  chapter?: string;
  tags: string;
  language: string;
}

const HIDDEN_TAGS = new Set(['en', 'zh', 'ja', 'fr', 'de', 'es', 'other']);

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

export default function Discover() {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookmarked, setBookmarked] = useState(false);
  const [authed, setAuthed] = useState(false);

  const fetchPassage = useCallback(async (preferUnread = false, skippedPassageId?: string) => {
    setLoading(true);
    setBookmarked(false);
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
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPassage(true); }, [fetchPassage]);

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

  return (
    <AppShell
      eyebrow="LifeOS reading surface"
      title="Today’s page is personal."
      subtitle="A quiet phone-native cockpit for passages chosen by your preference graph — not a global dice roll."
    >
      {loading ? (
        <div className="rp-glass-card p-9 text-center">
          <span className="loading loading-spinner loading-lg text-warning" />
          <p className="mt-4 opacity-60">Tuning the next passage to your reading trail…</p>
        </div>
      ) : passage ? (
        <article className="rp-glass-card rp-passage-card p-6 sm:p-8">
          <div className="mb-5 flex items-center justify-between gap-3">
            <span className="badge rp-chip rounded-full">Personal recommendation</span>
            <span className="text-xs uppercase tracking-[0.24em] opacity-45">{passage.language}</span>
          </div>
          <blockquote className="rp-quote">“{passage.text}”</blockquote>
          <div className="rp-meta mt-7 text-right">
            <div className="text-base font-bold text-base-content/90">{passage.bookTitle}</div>
            <div>{passage.author}{passage.chapter ? ` · ${passage.chapter}` : ''}</div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {parsePassageTags(passage.tags).map(tag => (
              <span key={tag} className="badge rp-chip badge-sm rounded-full">{tag}</span>
            ))}
          </div>
          <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <button
              className="btn btn-outline border-warning/40 text-warning hover:border-warning hover:bg-warning hover:text-black"
              onClick={() => fetchPassage(false, passage.id)}
            >
              Next tuned page →
            </button>
            {authed ? (
              <button
                className={`btn ${bookmarked ? 'btn-success' : 'btn-primary'}`}
                onClick={handleBookmark}
                disabled={bookmarked}
              >
                {bookmarked ? '✓ Saved to shelf' : '🔖 Save to shelf'}
              </button>
            ) : (
              <Link to="/signin" className="btn btn-ghost opacity-70">
                Sign in to bookmark
              </Link>
            )}
          </div>
        </article>
      ) : (
        <div className="alert alert-warning">No passages found.</div>
      )}
    </AppShell>
  );
}
