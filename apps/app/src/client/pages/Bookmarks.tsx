import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logtoClient } from '../lib/logto';
import { apiFetch } from '../lib/api';
import { isOfflineError, readBookmarksOfflineCache, saveBookmarksOfflineCache, useOnlineStatus } from '../lib/offline';
import ListenControl from '../components/ListenControl';

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
  id: string; createdAt: string; passage: Passage; collectionItems?: BookmarkCollectionItem[]; passageReviews?: PassageReview[];
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
  return [bookmark.passage.text, bookmark.passage.bookTitle, bookmark.passage.author, tags, collections]
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
  const online = useOnlineStatus();

  const loadOfflineCache = () => {
    const cached = readBookmarksOfflineCache();
    if (!cached) return false;
    setBookmarks((cached.bookmarks as Bookmark[]) || []);
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

  const removeBookmark = async (id: string) => {
    if (offlineMode) return;
    await apiFetch(`/bookmarks/${id}`, { method: 'DELETE' });
    await refresh();
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

  const markThemedReview = async (bookmarkId: string, action: 'reviewed' | 'skip') => {
    if (offlineMode) return;
    setBusy(true);
    setReviewStatus(null);
    try {
      await apiFetch(`/daily-review/${bookmarkId}`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      setReviewStatus(action === 'reviewed' ? 'Saved passage reviewed — it will rest before returning.' : 'Skipped for today — it will not immediately repeat.');
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
                      <p className="font-serif leading-relaxed mt-2">{bookmark.passage.text.slice(0, 260)}{bookmark.passage.text.length > 260 ? '…' : ''}</p>
                      <ListenControl text={bookmark.passage.text} title={`${bookmark.passage.bookTitle} saved passage`} compact className="mt-2" />
                      <div className="text-right opacity-60 text-sm mt-2">{bookmark.passage.bookTitle} — {bookmark.passage.author}</div>
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
                    <ListenControl text={bm.passage.text} title={`${bm.passage.bookTitle} saved passage`} compact />
                    <div className="text-right opacity-60 text-sm">{bm.passage.bookTitle} — {bm.passage.author}</div>
                    {bmTags.length > 0 && <div className="flex flex-wrap gap-1">{bmTags.map(tag => <span key={tag} className="badge badge-ghost badge-sm">#{tag}</span>)}</div>}
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
