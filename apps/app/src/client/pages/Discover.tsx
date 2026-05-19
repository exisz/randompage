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
  const [searchParams] = useSearchParams();
  const pushPassageId = searchParams.get('passageId');
  const pushSource = searchParams.get('source');

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

  const fetchPassageById = useCallback(async (passageId: string, source?: string | null) => {
    setLoading(true);
    setBookmarked(false);
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
    } catch (e) {
      console.error(e);
      await fetchPassage(true);
    } finally {
      setLoading(false);
    }
  }, [fetchPassage]);

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

  return (
    <div className="min-h-screen bg-base-100 p-4">
      {/* Nav */}
      <nav className="navbar bg-base-200 rounded-box mb-6 shadow">
        <div className="flex-1">
          <span className="font-serif text-xl">📖 RandomPage</span>
        </div>
        <div className="flex-none gap-2">
          <Link to="/bookmarks" className="btn btn-ghost btn-sm">Bookmarks</Link>
          <Link to="/history" className="btn btn-ghost btn-sm">History</Link>
          <Link to="/settings" className="btn btn-ghost btn-sm">Settings</Link>
        </div>
      </nav>

      {/* Passage Card */}
      <div className="max-w-2xl mx-auto">
        {loading ? (
          <div className="card bg-base-200 shadow-xl">
            <div className="card-body items-center">
              <span className="loading loading-spinner loading-lg" />
              <p className="opacity-60">Finding a passage for you…</p>
            </div>
          </div>
        ) : passage ? (
          <div className="card bg-base-200 shadow-xl">
            <div className="card-body gap-4">
              <blockquote className="font-serif text-lg leading-relaxed border-l-4 border-primary pl-4">
                {passage.text}
              </blockquote>
              <div className="text-right opacity-70 text-sm">
                <div className="font-semibold">{passage.bookTitle}</div>
                <div>{passage.author}{passage.chapter ? ` · ${passage.chapter}` : ''}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                {parsePassageTags(passage.tags).map(tag => (
                  <span key={tag} className="badge badge-ghost badge-sm">{tag}</span>
                ))}
              </div>
              <div className="card-actions justify-between">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => fetchPassage(false, passage.id)}
                >
                  Next passage →
                </button>
                {authed && (
                  <button
                    className={`btn btn-sm ${bookmarked ? 'btn-success' : 'btn-primary'}`}
                    onClick={handleBookmark}
                    disabled={bookmarked}
                  >
                    {bookmarked ? '✓ Saved' : '🔖 Bookmark'}
                  </button>
                )}
                {!authed && (
                  <Link to="/signin" className="btn btn-sm btn-ghost opacity-60">
                    Sign in to bookmark
                  </Link>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="alert alert-warning">No passages found.</div>
        )}
      </div>
    </div>
  );
}
