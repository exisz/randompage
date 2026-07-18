import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ListenControl from '../components/ListenControl';
import SharePassageButton from '../components/SharePassageButton';
import SharePassageImageButton from '../components/SharePassageImageButton';
import BookSourceLink from '../components/BookSourceLink';
import { logtoClient } from '../lib/logto';
import { apiFetch } from '../lib/api';
import { addPassageToReadingQueue, isPassageQueued } from '../lib/readingQueue';

interface Passage {
  id: string;
  text: string;
  bookTitle: string;
  author: string;
  chapter?: string;
  tags: string;
  language?: string;
  position: number;
}

interface PlaylistPayload {
  shareId: string;
  title: string;
  note?: string | null;
  createdAt: string;
  passages: Passage[];
}

function parseTags(tags: string) {
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return tags.split(',').map(tag => tag.trim()).filter(Boolean);
  }
}

export default function Playlist() {
  const { shareId } = useParams();
  const [playlist, setPlaylist] = useState<PlaylistPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [queuedIds, setQueuedIds] = useState<Set<string>>(() => new Set());
  const redirectUri = `${window.location.origin}/callback`;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [response, isAuth] = await Promise.all([
          fetch(`/api/playlists/${encodeURIComponent(shareId ?? '')}`),
          logtoClient.isAuthenticated().catch(() => false),
        ]);
        if (!response.ok) throw new Error(response.status === 404 ? 'Playlist not found' : 'Could not load this playlist.');
        const data = await response.json();
        if (!cancelled) {
          setPlaylist(data.playlist);
          setSignedIn(isAuth);
          setQueuedIds(new Set((data.playlist?.passages ?? []).filter((passage: Passage) => isPassageQueued(passage.id)).map((passage: Passage) => passage.id)));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [shareId]);

  const signIn = async () => {
    await logtoClient.signIn(redirectUri);
  };

  const savePassage = async (passage: Passage) => {
    try {
      setStatus(`Saving “${passage.bookTitle}”…`);
      const response = await apiFetch('/bookmarks', { method: 'POST', body: JSON.stringify({ passageId: passage.id }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Save failed');
      setStatus(`Saved “${passage.bookTitle}” to your RandomPage shelf.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const queuePassage = (passage: Passage) => {
    addPassageToReadingQueue(passage);
    setQueuedIds(new Set([...queuedIds, passage.id]));
    setStatus(`Queued “${passage.bookTitle}” on this device.`);
  };

  if (loading) return <main className="min-h-screen bg-base-100 p-6"><div className="loading loading-spinner loading-lg" /></main>;
  if (error || !playlist) {
    return <main className="min-h-screen bg-base-100 p-6"><div className="alert alert-error max-w-xl mx-auto"><span>{error || 'Playlist not found'}</span></div></main>;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_hsl(var(--p)/0.18),_transparent_36%),linear-gradient(180deg,_hsl(var(--b1)),_hsl(var(--b2)))] p-4 text-base-content">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-16 pt-4">
        <section className="card border border-primary/20 bg-base-100/90 shadow-xl">
          <div className="card-body gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-primary/70">RandomPage shared playlist</p>
                <h1 className="font-serif text-3xl leading-tight">{playlist.title}</h1>
              </div>
              <span className="badge badge-primary badge-outline">{playlist.passages.length} pages</span>
            </div>
            {playlist.note && <p className="rounded-box bg-base-200 p-3 text-sm opacity-80">{playlist.note}</p>}
            <p className="text-sm opacity-70">A read-only passage path made from existing RandomPage book passages — no summaries, comments, follows, or social feed.</p>
            {!signedIn ? (
              <div className="alert bg-primary/10 text-sm">
                <span>Sign in to save these passages into your own shelf, or keep reading them here publicly.</span>
                <button className="btn btn-primary btn-sm" onClick={signIn}>Sign in to save</button>
              </div>
            ) : status ? <div className="alert alert-success py-2 text-sm"><span>{status}</span></div> : null}
          </div>
        </section>

        {playlist.passages.map((passage) => {
          const tags = parseTags(passage.tags).slice(0, 5);
          return (
            <article key={passage.id} className="card border border-base-content/10 bg-base-100/90 shadow">
              <div className="card-body gap-3 p-4">
                <div className="flex items-center justify-between gap-2 text-xs opacity-60">
                  <span>Page {passage.position} of {playlist.passages.length}</span>
                  <BookSourceLink bookTitle={passage.bookTitle} author={passage.author} compact className="items-end" />
                </div>
                <p className="font-serif text-lg leading-relaxed">{passage.text}</p>
                {tags.length > 0 && <div className="flex flex-wrap gap-1">{tags.map(tag => <span key={tag} className="badge badge-ghost badge-sm">#{tag}</span>)}</div>}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ListenControl text={passage.text} title={`${passage.bookTitle} shared page`} compact />
                    <SharePassageButton passage={passage} compact />
                    <SharePassageImageButton passage={passage} compact />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link className="btn btn-outline btn-xs" to={`/discover?passageId=${encodeURIComponent(passage.id)}`}>Open</Link>
                    <button className="btn btn-outline btn-xs" disabled={queuedIds.has(passage.id)} onClick={() => queuePassage(passage)}>{queuedIds.has(passage.id) ? '✓ Queued' : 'Add to queue'}</button>
                    {signedIn ? <button className="btn btn-primary btn-xs" onClick={() => savePassage(passage)}>Save</button> : <button className="btn btn-primary btn-xs" onClick={signIn}>Sign in to save</button>}
                  </div>
                </div>
              </div>
            </article>
          );
        })}

        <Link className="btn btn-ghost" to="/discover">Discover more passages</Link>
      </div>
    </main>
  );
}
