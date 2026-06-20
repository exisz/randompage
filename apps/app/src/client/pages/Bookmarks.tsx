import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logtoClient } from '../lib/logto';
import { apiFetch } from '../lib/api';
import { isOfflineError, readBookmarksOfflineCache, saveBookmarksOfflineCache, useOnlineStatus } from '../lib/offline';
import ListenControl from '../components/ListenControl';
import SharePassageButton from '../components/SharePassageButton';
import SharePassageImageButton from '../components/SharePassageImageButton';
import BookSourceLink from '../components/BookSourceLink';
import { addPassageToReadingQueue, clearReadingQueue, readReadingQueue, removePassageFromReadingQueue, type QueuedPassage } from '../lib/readingQueue';
import { copyPassageExport, downloadPassageExport } from '../lib/passageExport';

interface Passage {
  id: string; text: string; bookTitle: string; author: string; chapter?: string; tags: string;
}
interface BookmarkCollectionItem { collection: { id: string; name: string } }
interface PassageReview {
  reviewedAt: string;
  dueAfter: string;
  action: string;
}
interface Bookmark {
  id: string; createdAt: string; note?: string | null; passage: Passage; collectionItems?: BookmarkCollectionItem[]; passageReviews?: PassageReview[];
}
interface Collection {
  id: string; name: string; updatedAt: string; items: { bookmarkId: string }[];
}

function parseTags(tags: string) {
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return tags.split(',').map(tag => tag.trim()).filter(Boolean);
  }
}

function passageSearchText(bookmark: Bookmark) {
  const tags = parseTags(bookmark.passage.tags).join(' ');
  const collections = bookmark.collectionItems?.map(item => item.collection.name).join(' ') ?? '';
  return [bookmark.passage.text, bookmark.passage.bookTitle, bookmark.passage.author, bookmark.note ?? '', tags, collections]
    .join(' ')
    .toLowerCase();
}

export default function Bookmarks() {
  const navigate = useNavigate();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState('all');
  const [activeCollection, setActiveCollection] = useState('all');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [busy, setBusy] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineCachedAt, setOfflineCachedAt] = useState<string | null>(null);
  const [reviewTheme, setReviewTheme] = useState('');
  const [reviewTopic, setReviewTopic] = useState('');
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [recallMode, setRecallMode] = useState(false);
  const [revealedRecallIds, setRevealedRecallIds] = useState<Set<string>>(() => new Set());
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteBusyId, setNoteBusyId] = useState<string | null>(null);
  const [readingQueue, setReadingQueue] = useState<QueuedPassage[]>(() => readReadingQueue());
  const [queueStatus, setQueueStatus] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const online = useOnlineStatus();

  const loadOfflineCache = () => {
    const cached = readBookmarksOfflineCache();
    if (!cached) return false;
    const cachedBookmarks = (cached.bookmarks as Bookmark[]) || [];
    setBookmarks(cachedBookmarks);
    setNoteDrafts(Object.fromEntries(cachedBookmarks.map(bookmark => [bookmark.id, bookmark.note ?? ''])));
    setCollections((cached.collections as Collection[]) || []);
    setOfflineMode(true);
    setOfflineCachedAt(cached.cachedAt);
    return true;
  };

  const refresh = async () => {
    try {
      const [bookmarksRes, collectionsRes] = await Promise.all([
        apiFetch('/bookmarks'),
        apiFetch('/bookmark-collections'),
      ]);
      const bookmarksData = await bookmarksRes.json();
      const collectionsData = await collectionsRes.json();
      const nextBookmarks = bookmarksData.bookmarks || [];
      const nextCollections = collectionsData.collections || [];
      setBookmarks(nextBookmarks);
      setNoteDrafts(Object.fromEntries(nextBookmarks.map((bookmark: Bookmark) => [bookmark.id, bookmark.note ?? ''])));
      setCollections(nextCollections);
      setOfflineMode(false);
      setOfflineCachedAt(null);
      saveBookmarksOfflineCache({ bookmarks: nextBookmarks, collections: nextCollections });
    } catch (error) {
      if (!isOfflineError(error) || !loadOfflineCache()) throw error;
    }
  };

  useEffect(() => {
    logtoClient.isAuthenticated().then(auth => {
      if (!auth) { navigate('/signin'); return; }
      refresh().finally(() => setLoading(false));
    });
  }, [navigate]);

  const tags = useMemo(() => {
    const all = new Set<string>();
    for (const bookmark of bookmarks) parseTags(bookmark.passage.tags).forEach(tag => all.add(tag));
    return Array.from(all).sort((a, b) => a.localeCompare(b));
  }, [bookmarks]);

  const filteredBookmarks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return bookmarks.filter(bookmark => {
      if (needle && !passageSearchText(bookmark).includes(needle)) return false;
      if (activeTag !== 'all' && !parseTags(bookmark.passage.tags).includes(activeTag)) return false;
      if (activeCollection === 'unfiled') return (bookmark.collectionItems?.length ?? 0) === 0;
      if (activeCollection !== 'all') return bookmark.collectionItems?.some(item => item.collection.id === activeCollection) ?? false;
      return true;
    });
  }, [bookmarks, query, activeTag, activeCollection]);

  const exportTitle = useMemo(() => {
    if (activeCollection !== 'all' && activeCollection !== 'unfiled') {
      const collection = collections.find(item => item.id === activeCollection);
      if (collection) return `RandomPage saved passages — ${collection.name}`;
    }
    if (activeCollection === 'unfiled') return 'RandomPage saved passages — Unfiled';
    if (activeTag !== 'all') return `RandomPage saved passages — #${activeTag}`;
    if (query.trim()) return `RandomPage saved passages — ${query.trim()}`;
    return 'RandomPage saved passages';
  }, [activeCollection, activeTag, collections, query]);

  const exportDescription = useMemo(() => {
    const filters = [
      query.trim() ? `search “${query.trim()}”` : '',
      activeTag !== 'all' ? `tag #${activeTag}` : '',
      activeCollection === 'unfiled' ? 'unfiled bookmarks' : '',
      activeCollection !== 'all' && activeCollection !== 'unfiled' ? `collection ${collections.find(item => item.id === activeCollection)?.name ?? activeCollection}` : '',
    ].filter(Boolean);
    return filters.length ? `Filtered export: ${filters.join(', ')}.` : 'All saved RandomPage passages in your Bookmarks.';
  }, [activeCollection, activeTag, collections, query]);

  const exportFilteredBookmarks = async (format: 'html' | 'txt' | 'copy') => {
    if (filteredBookmarks.length === 0) return;
    const options = {
      title: exportTitle,
      description: exportDescription,
      passages: filteredBookmarks.map(bookmark => ({ ...bookmark.passage, note: bookmark.note })),
    };
    try {
      if (format === 'copy') {
        await copyPassageExport(options);
        setExportStatus(`Copied ${filteredBookmarks.length} saved passages for Kindle/read-later.`);
      } else {
        downloadPassageExport({ ...options, format });
        setExportStatus(`Downloaded ${filteredBookmarks.length} saved passages as ${format.toUpperCase()}.`);
      }
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : String(error));
    }
    window.setTimeout(() => setExportStatus(null), 3500);
  };

  const reviewThemes = useMemo(() => {
    const options = [
      ...tags.map(tag => ({ value: `tag:${tag}`, label: `#${tag}`, type: 'tag' })),
      ...collections.map(collection => ({ value: `collection:${collection.id}`, label: collection.name, type: 'collection' })),
    ];
    return options;
  }, [tags, collections]);

  const topicNeedles = useMemo(() => {
    const stopwords = new Set(['a', 'an', 'and', 'are', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'under', 'with']);
    return reviewTopic
      .trim()
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .filter(needle => needle.length > 2 && !stopwords.has(needle));
  }, [reviewTopic]);

  const reviewThemeLabel = useMemo(() => {
    if (reviewTopic.trim()) return `topic: ${reviewTopic.trim()}`;
    if (reviewTheme.startsWith('tag:')) return `#${reviewTheme.slice(4)}`;
    if (reviewTheme.startsWith('collection:')) return collections.find(collection => collection.id === reviewTheme.slice(11))?.name ?? 'selected collection';
    return '';
  }, [collections, reviewTheme, reviewTopic]);

  const themedReviewQueue = useMemo(() => {
    if (!reviewTheme && topicNeedles.length === 0) return [];
    const now = Date.now();
    return bookmarks
      .filter(bookmark => {
        if (topicNeedles.length > 0) {
          const haystack = passageSearchText(bookmark);
          if (!topicNeedles.every(needle => haystack.includes(needle))) return false;
        } else if (reviewTheme.startsWith('tag:')) {
          const tag = reviewTheme.slice(4);
          if (!parseTags(bookmark.passage.tags).includes(tag)) return false;
        } else if (reviewTheme.startsWith('collection:')) {
          const collectionId = reviewTheme.slice(11);
          if (!bookmark.collectionItems?.some(item => item.collection.id === collectionId)) return false;
        } else return false;
        const latest = bookmark.passageReviews?.[0];
        return !latest || new Date(latest.dueAfter).getTime() <= now;
      })
      .slice(0, 5);
  }, [bookmarks, reviewTheme, topicNeedles]);

  const recallQueue = useMemo(() => {
    const now = Date.now();
    return bookmarks
      .filter(bookmark => {
        const latest = bookmark.passageReviews?.[0];
        return !latest || new Date(latest.dueAfter).getTime() <= now;
      })
      .slice(0, 5);
  }, [bookmarks]);

  const addBookmarkToQueue = (bookmark: Bookmark) => {
    const next = addPassageToReadingQueue(bookmark.passage);
    setReadingQueue(next);
    setQueueStatus(`Queued “${bookmark.passage.bookTitle}”.`);
    window.setTimeout(() => setQueueStatus(null), 2500);
  };

  const removeQueuedPassage = (passageId: string) => {
    setReadingQueue(removePassageFromReadingQueue(passageId));
  };

  const clearQueuedPassages = () => {
    if (!window.confirm('Clear your reading queue? Bookmarks and history will stay saved.')) return;
    setReadingQueue(clearReadingQueue());
  };

  const removeBookmark = async (id: string) => {
    if (offlineMode) return;
    await apiFetch(`/bookmarks/${id}`, { method: 'DELETE' });
    await refresh();
  };

  const saveBookmarkNote = async (bookmark: Bookmark, note: string | null) => {
    if (offlineMode) return;
    setNoteBusyId(bookmark.id);
    try {
      await apiFetch(`/bookmarks/${bookmark.id}/note`, {
        method: 'PATCH',
        body: JSON.stringify({ note }),
      });
      await refresh();
    } finally { setNoteBusyId(null); }
  };

  const createCollection = async () => {
    const name = newCollectionName.trim();
    if (!name || offlineMode) return;
    setBusy(true);
    try {
      await apiFetch('/bookmark-collections', { method: 'POST', body: JSON.stringify({ name }) });
      setNewCollectionName('');
      await refresh();
    } finally { setBusy(false); }
  };

  const renameCollection = async (collection: Collection) => {
    const name = window.prompt('Rename collection', collection.name)?.trim();
    if (!name || name === collection.name || offlineMode) return;
    setBusy(true);
    try {
      await apiFetch(`/bookmark-collections/${collection.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      await refresh();
    } finally { setBusy(false); }
  };

  const deleteCollection = async (collection: Collection) => {
    if (offlineMode || !window.confirm(`Delete collection “${collection.name}”? Bookmarks stay saved.`)) return;
    setBusy(true);
    try {
      await apiFetch(`/bookmark-collections/${collection.id}`, { method: 'DELETE' });
      if (activeCollection === collection.id) setActiveCollection('all');
      await refresh();
    } finally { setBusy(false); }
  };

  const setBookmarkCollection = async (bookmark: Bookmark, collectionId: string) => {
    if (offlineMode) return;
    setBusy(true);
    try {
      const currentIds = bookmark.collectionItems?.map(item => item.collection.id) ?? [];
      await Promise.all(currentIds.map(id => (
        apiFetch(`/bookmark-collections/${id}/bookmarks/${bookmark.id}`, { method: 'DELETE' })
      )));
      if (collectionId) {
        await apiFetch(`/bookmark-collections/${collectionId}/bookmarks`, {
          method: 'POST',
          body: JSON.stringify({ bookmarkId: bookmark.id }),
        });
      }
      await refresh();
    } finally { setBusy(false); }
  };

  const markThemedReview = async (bookmarkId: string, action: 'reviewed' | 'review_later' | 'skip') => {
    if (offlineMode) return;
    setBusy(true);
    setReviewStatus(null);
    try {
      await apiFetch(`/daily-review/${bookmarkId}`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      setReviewStatus(
        action === 'reviewed'
          ? 'Saved passage reviewed — it will rest before returning.'
          : action === 'review_later'
            ? 'Review later set — this recall card will come back tomorrow.'
            : 'Skipped for today — it will not immediately repeat.'
      );
      setRevealedRecallIds(prev => {
        const next = new Set(prev);
        next.delete(bookmarkId);
        return next;
      });
      await refresh();
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-base-100 p-3 sm:p-4">
      <nav className="navbar bg-base-200 rounded-box mb-5 shadow">
        <div className="flex-1"><Link to="/discover" className="font-serif text-xl">📖 RandomPage</Link></div>
        <div className="flex-none gap-1 sm:gap-2">
          <Link to="/discover" className="btn btn-ghost btn-sm">Discover</Link>
          <Link to="/history" className="btn btn-ghost btn-sm">History</Link>
          <Link to="/settings" className="btn btn-ghost btn-sm">Settings</Link>
        </div>
      </nav>
      <div className="max-w-2xl mx-auto pb-20">
        <div className="mb-4">
          <p className="text-xs uppercase tracking-[0.25em] opacity-50">Personal library</p>
          <h2 className="text-2xl font-serif">🔖 Bookmarks</h2>
        </div>

        {(!online || offlineMode) && (
          <div className="alert alert-info mb-4 shadow">
            <span>Offline library mode — showing cached saved passages{offlineCachedAt ? ` from ${new Date(offlineCachedAt).toLocaleString()}` : ''}. Reconnect to edit collections or sync fresh bookmarks.</span>
          </div>
        )}

        <div className="card bg-base-200 shadow mb-4">
          <div className="card-body gap-3 p-4">
            <label className="input input-bordered flex items-center gap-2 w-full">
              <span className="opacity-50">Search</span>
              <input value={query} onChange={e => setQuery(e.target.value)} className="grow" placeholder="title, author, text, tag…" />
            </label>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button className={`btn btn-xs ${activeTag === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTag('all')}>All tags</button>
              {tags.slice(0, 16).map(tag => <button key={tag} className={`btn btn-xs whitespace-nowrap ${activeTag === tag ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTag(tag)}>#{tag}</button>)}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button className={`btn btn-xs ${activeCollection === 'all' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setActiveCollection('all')}>All collections</button>
              <button className={`btn btn-xs ${activeCollection === 'unfiled' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setActiveCollection('unfiled')}>Unfiled</button>
              {collections.map(collection => <button key={collection.id} className={`btn btn-xs whitespace-nowrap ${activeCollection === collection.id ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setActiveCollection(collection.id)}>{collection.name}</button>)}
            </div>
            {(query || activeTag !== 'all' || activeCollection !== 'all') && (
              <button className="btn btn-link btn-xs self-start" onClick={() => { setQuery(''); setActiveTag('all'); setActiveCollection('all'); }}>Clear filters</button>
            )}
            <div className="rounded-box border border-base-content/10 bg-base-100/70 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] opacity-60">Kindle / read-later export</p>
                  <p className="text-sm opacity-75">Download or copy the current saved-passage view with title, author, excerpt, canonical URL, tags, and private note snippets.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary btn-xs" disabled={filteredBookmarks.length === 0} onClick={() => exportFilteredBookmarks('html')}>Export HTML</button>
                  <button className="btn btn-outline btn-xs" disabled={filteredBookmarks.length === 0} onClick={() => exportFilteredBookmarks('txt')}>TXT</button>
                  <button className="btn btn-ghost btn-xs" disabled={filteredBookmarks.length === 0} onClick={() => exportFilteredBookmarks('copy')}>Copy</button>
                </div>
              </div>
              {exportStatus && <p className="mt-2 text-xs opacity-70" role="status">{exportStatus}</p>}
            </div>
          </div>
        </div>


        <div className="card bg-gradient-to-br from-primary/10 via-base-200 to-accent/10 shadow mb-4" id="my-queue">
          <div className="card-body gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] opacity-50">My Queue</p>
                <h3 className="font-serif text-lg">Curated passage playlist</h3>
                <p className="text-sm opacity-70">Passages you add from Discover or Bookmarks stay here on this device in the order you queued them.</p>
              </div>
              <span className="badge badge-primary badge-outline shrink-0">{readingQueue.length}</span>
            </div>
            {queueStatus && <div className="alert alert-success py-2 text-sm"><span>{queueStatus}</span></div>}
            {readingQueue.length === 0 ? (
              <div className="rounded-box border border-dashed border-base-content/20 p-4 text-sm">
                <p className="font-medium">Your queue is empty.</p>
                <p className="opacity-70 mt-1">Use “Add to queue” on Discover cards or saved bookmarks to build a short reading/listening run.</p>
              </div>
            ) : (
              <>
                <div className="flex justify-end">
                  <button className="btn btn-ghost btn-xs text-error" onClick={clearQueuedPassages}>Clear queue</button>
                </div>
                <div className="flex flex-col gap-3">
                  {readingQueue.map((item, index) => {
                    const qTags = parseTags(item.passage.tags).slice(0, 4);
                    return (
                      <div key={`${item.id}-${item.addedAt}`} className="rounded-box bg-base-100/80 p-3 shadow-sm border border-primary/15">
                        <div className="flex items-center justify-between gap-2 text-xs opacity-60">
                          <span>Queue {index + 1} of {readingQueue.length}</span>
                          <span>added {new Date(item.addedAt).toLocaleDateString()}</span>
                        </div>
                        <p className="font-serif leading-relaxed mt-2">{item.passage.text.slice(0, 240)}{item.passage.text.length > 240 ? '…' : ''}</p>
                        <div className="mt-2 text-right text-sm"><BookSourceLink bookTitle={item.passage.bookTitle} author={item.passage.author} compact className="items-end opacity-60 hover:opacity-100" /></div>
                        {qTags.length > 0 && <div className="flex flex-wrap gap-1 mt-2">{qTags.map(tag => <span key={tag} className="badge badge-ghost badge-sm">#{tag}</span>)}</div>}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <ListenControl text={item.passage.text} title={`${item.passage.bookTitle} queued passage`} compact />
                            <SharePassageButton passage={item.passage} compact />
                            <SharePassageImageButton passage={item.passage} compact />
                          </div>
                          <button className="btn btn-ghost btn-xs text-error" onClick={() => removeQueuedPassage(item.passage.id)}>Remove from queue</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="card bg-base-200/70 shadow mb-4">
          <div className="card-body gap-3 p-4">
            <h3 className="font-serif text-lg">Collections</h3>
            <div className="join w-full">
              <input className="input input-bordered join-item flex-1" value={newCollectionName} onChange={e => setNewCollectionName(e.target.value)} placeholder="New collection, e.g. Philosophy" />
              <button className="btn btn-primary join-item" disabled={offlineMode || busy || !newCollectionName.trim()} onClick={createCollection}>Create</button>
            </div>
            {collections.length > 0 && <div className="flex flex-wrap gap-2">
              {collections.map(collection => (
                <div key={collection.id} className="badge badge-lg gap-2 py-4">
                  <span>{collection.name}</span><span className="opacity-50">{collection.items.length}</span>
                  <button className="link" onClick={() => renameCollection(collection)}>rename</button>
                  <button className="link text-error" onClick={() => deleteCollection(collection)}>delete</button>
                </div>
              ))}
            </div>}
          </div>
        </div>


        <div className="card bg-gradient-to-br from-accent/15 via-base-200 to-primary/10 shadow mb-4">
          <div className="card-body gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] opacity-50">Recall Cards</p>
                <h3 className="font-serif text-lg">Remember saved ideas</h3>
                <p className="text-sm opacity-70">A lightweight memory mode for due saved passages. Try to recall the idea first, then reveal the page and mark what should happen next.</p>
              </div>
              <button className={`btn btn-sm ${recallMode ? 'btn-accent' : 'btn-outline'}`} onClick={() => setRecallMode(value => !value)} disabled={offlineMode || bookmarks.length === 0}>
                {recallMode ? 'Close' : 'Start recall'}
              </button>
            </div>
            {bookmarks.length === 0 && (
              <div className="rounded-box border border-dashed border-base-content/20 p-4 text-sm">
                <p className="font-medium">No saved passages yet.</p>
                <p className="opacity-70 mt-1">Save a passage from <Link to="/discover" className="link">Discover</Link>, then return here to build your recall deck.</p>
              </div>
            )}
            {bookmarks.length > 0 && recallQueue.length === 0 && (
              <div className="rounded-box border border-dashed border-base-content/20 p-4 text-sm">
                <p className="font-medium">Nothing due for recall right now.</p>
                <p className="opacity-70 mt-1">Remembered cards rest for a week; Review later and Skip return sooner.</p>
              </div>
            )}
            {recallMode && recallQueue.length > 0 && (
              <div className="flex flex-col gap-3">
                {recallQueue.map((bookmark, index) => {
                  const isRevealed = revealedRecallIds.has(bookmark.id);
                  const bmTags = parseTags(bookmark.passage.tags).slice(0, 4);
                  return (
                    <div key={bookmark.id} className="rounded-box bg-base-100/85 p-3 shadow-sm border border-accent/20">
                      <div className="flex items-center justify-between gap-2 text-xs opacity-60">
                        <span>Recall {index + 1} of {recallQueue.length}</span>
                        {bookmark.passageReviews?.[0]?.reviewedAt && <span>last reviewed {new Date(bookmark.passageReviews[0].reviewedAt).toLocaleDateString()}</span>}
                      </div>
                      <p className="text-xs uppercase tracking-[0.22em] text-accent mt-3">Before revealing</p>
                      <h4 className="font-serif text-lg mt-1">What idea did this page contain?</h4>
                      <div className="rounded-box bg-base-200/80 p-3 mt-2 text-sm">
                        <BookSourceLink bookTitle={bookmark.passage.bookTitle} author={bookmark.passage.author} chapter={bookmark.passage.chapter} compact />
                      </div>
                      {bookmark.note && (
                        <div className="rounded-box bg-warning/10 border border-warning/20 p-3 mt-2 text-sm">
                          <p className="text-xs uppercase tracking-[0.18em] opacity-60">Your private note</p>
                          <p className="mt-1">{bookmark.note}</p>
                        </div>
                      )}
                      {bmTags.length > 0 && <div className="flex flex-wrap gap-1 mt-2">{bmTags.map(tag => <span key={tag} className="badge badge-ghost badge-sm">#{tag}</span>)}</div>}
                      {!isRevealed ? (
                        <button className="btn btn-accent btn-sm mt-3 w-full sm:w-auto" onClick={() => setRevealedRecallIds(prev => new Set(prev).add(bookmark.id))}>Reveal passage</button>
                      ) : (
                        <div className="mt-3">
                          <p className="font-serif leading-relaxed">{bookmark.passage.text}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <ListenControl text={bookmark.passage.text} title={`${bookmark.passage.bookTitle} recall card`} compact />
                            <SharePassageButton passage={bookmark.passage} compact />
                            <SharePassageImageButton passage={bookmark.passage} compact />
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                        <button className="btn btn-primary btn-sm" disabled={offlineMode || busy || !isRevealed} onClick={() => markThemedReview(bookmark.id, 'reviewed')}>Remembered</button>
                        <button className="btn btn-outline btn-sm" disabled={offlineMode || busy} onClick={() => markThemedReview(bookmark.id, 'review_later')}>Review later</button>
                        <button className="btn btn-ghost btn-sm" disabled={offlineMode || busy} onClick={() => markThemedReview(bookmark.id, 'skip')}>Skip</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="card bg-gradient-to-br from-primary/10 via-base-200 to-secondary/10 shadow mb-4">
          <div className="card-body gap-3 p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] opacity-50">Themed Review</p>
              <h3 className="font-serif text-lg">Revisit a focused shelf</h3>
              <p className="text-sm opacity-70">Choose a saved tag/collection, or type a topic like “stoicism under stress”, to review 1–5 due saved book passages outside the default Daily Review.</p>
            </div>
            <label className="input input-bordered flex items-center gap-2 w-full">
              <span className="opacity-50">Topic</span>
              <input
                value={reviewTopic}
                onChange={e => { setReviewTopic(e.target.value); setReviewStatus(null); }}
                className="grow"
                placeholder="stoicism under stress, grief, courage…"
                disabled={offlineMode}
              />
            </label>
            <div className="divider my-0 text-xs opacity-60">or pick a saved shelf</div>
            <select className="select select-bordered w-full" value={reviewTheme} onChange={e => { setReviewTheme(e.target.value); setReviewTopic(''); setReviewStatus(null); }} disabled={offlineMode || reviewThemes.length === 0}>
              <option value="">Select a tag or collection…</option>
              {tags.length > 0 && <optgroup label="Tags">{tags.map(tag => <option key={`tag:${tag}`} value={`tag:${tag}`}>#{tag}</option>)}</optgroup>}
              {collections.length > 0 && <optgroup label="Collections">{collections.map(collection => <option key={`collection:${collection.id}`} value={`collection:${collection.id}`}>{collection.name}</option>)}</optgroup>}
            </select>
            {reviewThemes.length === 0 && !reviewTopic.trim() && <p className="text-sm opacity-70">Save passages with tags or create a collection first, then come back for a focused review queue.</p>}
            {reviewStatus && <div className="alert alert-success py-2 text-sm"><span>{reviewStatus}</span></div>}
            {reviewThemeLabel && <p className="text-xs opacity-60">Focused queue for <span className="font-medium">{reviewThemeLabel}</span>, searched only across your saved RandomPage book passages.</p>}
            {(reviewTheme || reviewTopic.trim()) && themedReviewQueue.length === 0 && (
              <div className="rounded-box border border-dashed border-base-content/20 p-4 text-sm">
                <p className="font-medium">No saved passages match this topic or are due for review right now.</p>
                <p className="opacity-70 mt-1">Try another topic/tag/collection, save more passages in <Link to="/discover" className="link">Discover</Link>, or organize saved passages in <button className="link" onClick={() => setActiveCollection('all')}>Bookmarks</button>.</p>
              </div>
            )}
            {themedReviewQueue.length > 0 && (
              <div className="flex flex-col gap-3">
                {themedReviewQueue.map((bookmark, index) => {
                  const bmTags = parseTags(bookmark.passage.tags).slice(0, 4);
                  return (
                    <div key={bookmark.id} className="rounded-box bg-base-100/80 p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2 text-xs opacity-60">
                        <span>Review {index + 1} of {themedReviewQueue.length}</span>
                        {bookmark.passageReviews?.[0]?.reviewedAt && <span>last reviewed {new Date(bookmark.passageReviews[0].reviewedAt).toLocaleDateString()}</span>}
                      </div>
                      {bookmark.note && (
                        <div className="rounded-box bg-warning/10 border border-warning/20 p-3 mt-2 text-sm">
                          <p className="text-xs uppercase tracking-[0.18em] opacity-60">Your private note</p>
                          <p className="mt-1">{bookmark.note}</p>
                        </div>
                      )}
                      <p className="font-serif leading-relaxed mt-2">{bookmark.passage.text.slice(0, 260)}{bookmark.passage.text.length > 260 ? '…' : ''}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <ListenControl text={bookmark.passage.text} title={`${bookmark.passage.bookTitle} saved passage`} compact />
                        <SharePassageButton passage={bookmark.passage} compact />
                            <SharePassageImageButton passage={bookmark.passage} compact />
                      </div>
                      <div className="mt-2 text-right text-sm"><BookSourceLink bookTitle={bookmark.passage.bookTitle} author={bookmark.passage.author} compact className="items-end opacity-60 hover:opacity-100" /></div>
                      {bmTags.length > 0 && <div className="flex flex-wrap gap-1 mt-2">{bmTags.map(tag => <span key={tag} className="badge badge-ghost badge-sm">#{tag}</span>)}</div>}
                      <div className="flex gap-2 justify-end mt-3">
                        <button className="btn btn-ghost btn-sm" disabled={offlineMode || busy} onClick={() => markThemedReview(bookmark.id, 'skip')}>Skip today</button>
                        <button className="btn btn-primary btn-sm" disabled={offlineMode || busy} onClick={() => markThemedReview(bookmark.id, 'reviewed')}>Reviewed</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center"><span className="loading loading-spinner loading-lg" /></div>
        ) : bookmarks.length === 0 ? (
          <div className="text-center opacity-60 py-10">
            <p>No bookmarks yet.</p>
            <Link to="/discover" className="btn btn-primary btn-sm mt-4">Discover passages</Link>
          </div>
        ) : filteredBookmarks.length === 0 ? (
          <div className="text-center py-10">
            <p className="opacity-70">No matches in your saved passages.</p>
            <button className="btn btn-primary btn-sm mt-4" onClick={() => { setQuery(''); setActiveTag('all'); setActiveCollection('all'); }}>Clear search</button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {filteredBookmarks.map(bm => {
              const bmTags = parseTags(bm.passage.tags).slice(0, 5);
              return (
                <div key={bm.id} className="card bg-base-200 shadow">
                  <div className="card-body gap-3 py-4">
                    <p className="font-serif leading-relaxed">{bm.passage.text.slice(0, 220)}{bm.passage.text.length > 220 ? '…' : ''}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <ListenControl text={bm.passage.text} title={`${bm.passage.bookTitle} saved passage`} compact />
                      <SharePassageButton passage={bm.passage} compact />
                      <SharePassageImageButton passage={bm.passage} compact />
                      <button
                        className="btn btn-outline btn-xs"
                        onClick={() => addBookmarkToQueue(bm)}
                        disabled={readingQueue.some(item => item.passage.id === bm.passage.id)}
                      >{readingQueue.some(item => item.passage.id === bm.passage.id) ? '✓ Queued' : 'Add to queue'}</button>
                    </div>
                    <div className="text-right text-sm"><BookSourceLink bookTitle={bm.passage.bookTitle} author={bm.passage.author} compact className="items-end opacity-60 hover:opacity-100" /></div>
                    {bmTags.length > 0 && <div className="flex flex-wrap gap-1">{bmTags.map(tag => <span key={tag} className="badge badge-ghost badge-sm">#{tag}</span>)}</div>}
                    <div className="rounded-box bg-base-100/70 border border-base-content/10 p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-xs uppercase tracking-[0.18em] opacity-60">Private note</span>
                        {bm.note ? <span className="badge badge-warning badge-sm">saved</span> : <span className="badge badge-ghost badge-sm">optional</span>}
                      </div>
                      {bm.note && <p className="text-sm opacity-80 mb-2">{bm.note.length > 180 ? `${bm.note.slice(0, 180)}…` : bm.note}</p>}
                      <textarea
                        className="textarea textarea-bordered w-full text-sm"
                        rows={3}
                        maxLength={1200}
                        value={noteDrafts[bm.id] ?? bm.note ?? ''}
                        onChange={e => setNoteDrafts(prev => ({ ...prev, [bm.id]: e.target.value }))}
                        placeholder="Add a private reflection, context, or why this passage mattered…"
                        disabled={offlineMode || noteBusyId === bm.id}
                      />
                      <div className="flex flex-wrap justify-end gap-2 mt-2">
                        <button
                          className="btn btn-primary btn-xs"
                          disabled={offlineMode || noteBusyId === bm.id || (noteDrafts[bm.id] ?? bm.note ?? '').trim() === (bm.note ?? '')}
                          onClick={() => saveBookmarkNote(bm, (noteDrafts[bm.id] ?? '').trim() || null)}
                        >Save note</button>
                        <button
                          className="btn btn-ghost btn-xs"
                          disabled={offlineMode || noteBusyId === bm.id || !(bm.note || (noteDrafts[bm.id] ?? '').trim())}
                          onClick={() => { setNoteDrafts(prev => ({ ...prev, [bm.id]: '' })); saveBookmarkNote(bm, null); }}
                        >Clear</button>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                      <select className="select select-bordered select-sm w-full sm:max-w-xs" disabled={offlineMode || busy} value={bm.collectionItems?.[0]?.collection.id ?? ''} onChange={e => setBookmarkCollection(bm, e.target.value)}>
                        <option value="">No collection</option>
                        {collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
                      </select>
                      <button className="btn btn-ghost btn-xs text-error" disabled={offlineMode} onClick={() => removeBookmark(bm.id)}>Remove bookmark</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
