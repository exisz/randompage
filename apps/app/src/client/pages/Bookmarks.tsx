import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logtoClient } from '../lib/logto';
import { apiFetch } from '../lib/api';

interface Passage {
  id: string; text: string; bookTitle: string; author: string; chapter?: string; tags: string;
}
interface BookmarkCollectionItem { collection: { id: string; name: string } }
interface Bookmark {
  id: string; createdAt: string; passage: Passage; collectionItems?: BookmarkCollectionItem[];
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

  const refresh = async () => {
    const [bookmarksRes, collectionsRes] = await Promise.all([
      apiFetch('/bookmarks'),
      apiFetch('/bookmark-collections'),
    ]);
    const bookmarksData = await bookmarksRes.json();
    const collectionsData = await collectionsRes.json();
    setBookmarks(bookmarksData.bookmarks || []);
    setCollections(collectionsData.collections || []);
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

  const removeBookmark = async (id: string) => {
    await apiFetch(`/bookmarks/${id}`, { method: 'DELETE' });
    await refresh();
  };

  const createCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await apiFetch('/bookmark-collections', { method: 'POST', body: JSON.stringify({ name }) });
      setNewCollectionName('');
      await refresh();
    } finally { setBusy(false); }
  };

  const renameCollection = async (collection: Collection) => {
    const name = window.prompt('Rename collection', collection.name)?.trim();
    if (!name || name === collection.name) return;
    setBusy(true);
    try {
      await apiFetch(`/bookmark-collections/${collection.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      await refresh();
    } finally { setBusy(false); }
  };

  const deleteCollection = async (collection: Collection) => {
    if (!window.confirm(`Delete collection “${collection.name}”? Bookmarks stay saved.`)) return;
    setBusy(true);
    try {
      await apiFetch(`/bookmark-collections/${collection.id}`, { method: 'DELETE' });
      if (activeCollection === collection.id) setActiveCollection('all');
      await refresh();
    } finally { setBusy(false); }
  };

  const setBookmarkCollection = async (bookmark: Bookmark, collectionId: string) => {
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
              <button className="btn btn-primary join-item" disabled={busy || !newCollectionName.trim()} onClick={createCollection}>Create</button>
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
                    <div className="text-right opacity-60 text-sm">{bm.passage.bookTitle} — {bm.passage.author}</div>
                    {bmTags.length > 0 && <div className="flex flex-wrap gap-1">{bmTags.map(tag => <span key={tag} className="badge badge-ghost badge-sm">#{tag}</span>)}</div>}
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                      <select className="select select-bordered select-sm w-full sm:max-w-xs" disabled={busy} value={bm.collectionItems?.[0]?.collection.id ?? ''} onChange={e => setBookmarkCollection(bm, e.target.value)}>
                        <option value="">No collection</option>
                        {collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
                      </select>
                      <button className="btn btn-ghost btn-xs text-error" onClick={() => removeBookmark(bm.id)}>Remove bookmark</button>
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
