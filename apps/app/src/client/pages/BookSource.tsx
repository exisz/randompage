import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { logtoClient } from '../lib/logto';
import ListenControl from '../components/ListenControl';
import SharePassageButton from '../components/SharePassageButton';
import SharePassageImageButton from '../components/SharePassageImageButton';
import { addPassageToReadingQueue, isPassageQueued } from '../lib/readingQueue';
import { copyPassageExport, downloadPassageExport, emailPassageExport } from '../lib/passageExport';

interface Passage {
  id: string;
  text: string;
  bookTitle: string;
  author: string;
  chapter?: string | null;
  tags: string;
  language: string;
  isSaved?: boolean;
  isRead?: boolean;
  note?: string | null;
}

interface BookSourcePayload {
  source: {
    title: string;
    author: string;
    passageCount: number;
    savedCount: number | null;
  };
  passages: Passage[];
}

interface ReadLaterDestination { email: string; active: boolean; verified: boolean; configured: boolean; }

const HIDDEN_TAGS = new Set(['en', 'zh', 'ja', 'fr', 'de', 'es', 'other']);

function parseTags(raw: string | null | undefined) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // fall through
  }
  return raw.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function visibleTags(raw: string) {
  return parseTags(raw).filter((tag) => !HIDDEN_TAGS.has(tag.toLowerCase())).slice(0, 4);
}

function excerpt(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 260 ? `${clean.slice(0, 260).trim()}…` : clean;
}

export default function BookSource() {
  const [searchParams] = useSearchParams();
  const title = searchParams.get('title') ?? '';
  const author = searchParams.get('author') ?? '';
  const [payload, setPayload] = useState<BookSourcePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});
  const [queuedIds, setQueuedIds] = useState<Set<string>>(() => new Set());
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [readLaterDestination, setReadLaterDestination] = useState<ReadLaterDestination | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ title });
    if (author) params.set('author', author);
    return params.toString();
  }, [title, author]);

  const load = useCallback(async () => {
    if (!title.trim()) {
      setError('Missing book title. Open this page from a passage card.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const authed = await logtoClient.isAuthenticated();
      const [res, preferencesRes] = await Promise.all([
        authed ? apiFetch(`/book-source?${query}`) : fetch(`/api/book-source?${query}`),
        authed ? apiFetch('/preferences') : Promise.resolve(null),
      ]);
      if (!res.ok) throw new Error(`Book source returned HTTP ${res.status}`);
      const data = await res.json() as BookSourcePayload;
      if (preferencesRes) {
        const preferencesData = await preferencesRes.json();
        setReadLaterDestination(preferencesData.readLaterDestination || null);
      }
      setPayload(data);
      setQueuedIds(new Set(data.passages.filter((passage) => isPassageQueued(passage.id)).map((passage) => passage.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [query, title]);

  useEffect(() => { void load(); }, [load]);

  const savePassage = async (passage: Passage) => {
    setSaveStatus((prev) => ({ ...prev, [passage.id]: 'Saving…' }));
    try {
      const res = await apiFetch('/bookmarks', {
        method: 'POST',
        body: JSON.stringify({ passageId: passage.id }),
      });
      if (!res.ok) throw new Error(res.status === 401 ? 'Sign in to save passages.' : `Save failed (${res.status}).`);
      setPayload((current) => current ? {
        ...current,
        source: { ...current.source, savedCount: current.source.savedCount === null ? null : current.source.savedCount + (passage.isSaved ? 0 : 1) },
        passages: current.passages.map((item) => item.id === passage.id ? { ...item, isSaved: true } : item),
      } : current);
      setSaveStatus((prev) => ({ ...prev, [passage.id]: 'Saved to Bookmarks.' }));
    } catch (e) {
      setSaveStatus((prev) => ({ ...prev, [passage.id]: e instanceof Error ? e.message : String(e) }));
    }
  };

  const queuePassage = (passage: Passage) => {
    addPassageToReadingQueue(passage);
    setQueuedIds((prev) => new Set(prev).add(passage.id));
  };

  const exportSavedSourcePassages = async (format: 'html' | 'txt' | 'copy' | 'email') => {
    if (!payload) return;
    const savedPassages = payload.passages.filter((passage) => passage.isSaved);
    if (savedPassages.length === 0) return;
    const options = {
      title: `RandomPage saved passages — ${payload.source.title}`,
      description: `Saved passages from ${payload.source.title}${payload.source.author ? ` by ${payload.source.author}` : ''}, ordered the same way as this source detail page.`,
      passages: savedPassages,
    };
    try {
      if (format === 'copy') {
        await copyPassageExport(options);
        setExportStatus(`Copied ${savedPassages.length} saved source passages.`);
      } else if (format === 'email') {
        const email = readLaterDestination?.active ? readLaterDestination.email : '';
        if (!email) throw new Error('Save an active Kindle/read-later destination in Settings first.');
        const result = await emailPassageExport(options, email);
        setExportStatus(result.mode === 'mailto'
          ? `Opened an email draft with ${savedPassages.length} saved source passages to ${email}.`
          : `Bundle was too large for mailto; downloaded TXT and copied text for ${email}.`);
      } else {
        downloadPassageExport({ ...options, format });
        setExportStatus(`Downloaded ${savedPassages.length} saved source passages as ${format.toUpperCase()}.`);
      }
    } catch (e) {
      setExportStatus(e instanceof Error ? e.message : String(e));
    }
    window.setTimeout(() => setExportStatus(null), 3500);
  };

  if (loading) {
    return <main className="min-h-screen bg-base-100 p-6"><span className="loading loading-spinner loading-lg" /><p className="mt-3 opacity-60">Opening this book…</p></main>;
  }

  if (error || !payload) {
    return (
      <main className="min-h-screen bg-base-100 p-6">
        <div className="alert alert-error max-w-2xl"><span>{error ?? 'Book source not found.'}</span></div>
        <Link to="/discover" className="btn btn-primary mt-4 rounded-2xl">Back to Discover</Link>
      </main>
    );
  }

  const hasMultiple = payload.source.passageCount > 1;

  return (
    <main className="min-h-screen bg-base-100 text-base-content">
      <section className="relative overflow-hidden border-b border-white/10 bg-gradient-to-br from-amber-200/15 via-base-200 to-primary/10 px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <Link to="/discover" className="btn btn-ghost btn-sm rounded-xl">← Discover</Link>
          <p className="mt-6 text-xs uppercase tracking-[0.32em] text-primary/80">Book source</p>
          <h1 className="mt-2 font-serif text-4xl leading-tight sm:text-5xl">{payload.source.title}</h1>
          <p className="mt-2 text-lg opacity-75">{payload.source.author || 'Unknown author'}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="badge badge-primary badge-outline">{payload.source.passageCount} {payload.source.passageCount === 1 ? 'passage' : 'passages'} available</span>
            {payload.source.savedCount !== null && <span className="badge badge-success badge-outline">{payload.source.savedCount} saved</span>}
            <span className="badge badge-ghost">Unread pages appear first when signed in</span>
          </div>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed opacity-70">
            Continue from one good passage into more existing RandomPage pages from the same book. This stays inside your personal book-passage discovery graph — no new summaries, feeds, or social layer.
          </p>
          {payload.source.savedCount !== null && (
            <div className="mt-5 rounded-box border border-base-content/10 bg-base-100/70 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] opacity-60">Kindle / read-later export</p>
                  <p className="text-sm opacity-75">Export or email only your saved passages from this source, with canonical URLs, tags, and private note snippets.</p>
                  {readLaterDestination?.configured ? <p className="text-xs opacity-60">Destination: {readLaterDestination.email} · {readLaterDestination.active ? 'active' : 'inactive in Settings'}</p> : <p className="text-xs opacity-60">Save a destination in Settings to show Email export.</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {readLaterDestination?.configured && readLaterDestination.active ? (
                    <button className="btn btn-secondary btn-xs" disabled={(payload.source.savedCount ?? 0) === 0} onClick={() => exportSavedSourcePassages('email')}>Email export</button>
                  ) : null}
                  <button className="btn btn-primary btn-xs" disabled={(payload.source.savedCount ?? 0) === 0} onClick={() => exportSavedSourcePassages('html')}>Export saved HTML</button>
                  <button className="btn btn-outline btn-xs" disabled={(payload.source.savedCount ?? 0) === 0} onClick={() => exportSavedSourcePassages('txt')}>TXT</button>
                  <button className="btn btn-ghost btn-xs" disabled={(payload.source.savedCount ?? 0) === 0} onClick={() => exportSavedSourcePassages('copy')}>Copy</button>
                </div>
              </div>
              {exportStatus && <p className="mt-2 text-xs opacity-70" role="status">{exportStatus}</p>}
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6">
        {!hasMultiple && (
          <div className="alert border border-dashed border-white/10 bg-base-200 text-sm">
            <span>Only one RandomPage passage is currently available for this book. Save it, share it, or return later as the library grows.</span>
          </div>
        )}
        {payload.passages.map((passage, index) => {
          const tags = visibleTags(passage.tags);
          const queued = queuedIds.has(passage.id);
          return (
            <article key={passage.id} className="card border border-white/10 bg-base-200/90 shadow-xl">
              <div className="card-body gap-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs opacity-60">
                  <span>Passage {index + 1} of {payload.source.passageCount}</span>
                  <div className="flex gap-2">
                    {passage.isRead ? <span className="badge badge-ghost badge-xs">read</span> : <span className="badge badge-primary badge-outline badge-xs">unread</span>}
                    {passage.isSaved && <span className="badge badge-success badge-xs">saved</span>}
                  </div>
                </div>
                {passage.chapter && <p className="text-xs uppercase tracking-[0.2em] text-primary/70">{passage.chapter}</p>}
                <p className="font-serif text-base leading-7 sm:text-lg">{excerpt(passage.text)}</p>
                {tags.length > 0 && <div className="flex flex-wrap gap-1">{tags.map((tag) => <span key={tag} className="badge badge-ghost badge-sm">#{tag}</span>)}</div>}
                {passage.note && (
                  <div className="rounded-box border border-warning/20 bg-warning/10 p-3 text-sm">
                    <p className="text-xs uppercase tracking-[0.18em] opacity-60">Your private note</p>
                    <p className="mt-1">{passage.note.length > 180 ? `${passage.note.slice(0, 180)}…` : passage.note}</p>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Link className="btn btn-primary btn-sm rounded-xl" to={`/discover?passageId=${encodeURIComponent(passage.id)}&source=discover`}>Open passage</Link>
                  <ListenControl text={passage.text} title={`${passage.bookTitle} passage`} compact />
                  <SharePassageButton passage={passage} compact />
                  <SharePassageImageButton passage={passage} compact />
                  <button className="btn btn-outline btn-sm rounded-xl" disabled={queued} onClick={() => queuePassage(passage)}>{queued ? '✓ Queued' : 'Add to queue'}</button>
                  <button className="btn btn-ghost btn-sm rounded-xl" disabled={passage.isSaved} onClick={() => savePassage(passage)}>{passage.isSaved ? '✓ Saved' : 'Save'}</button>
                </div>
                {saveStatus[passage.id] && <p className="text-xs opacity-60" role="status">{saveStatus[passage.id]}</p>}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
