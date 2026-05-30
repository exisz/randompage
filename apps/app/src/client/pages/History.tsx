import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logtoClient } from '../lib/logto';
import { apiFetch } from '../lib/api';

interface Passage {
  id: string; text: string; bookTitle: string; author: string; tags?: string;
}
interface PushHistoryEntry {
  id: string; sentAt: string; readAt: string | null; passage: Passage;
}
interface BrowsingHistoryEntry {
  id: string; createdAt: string; action: 'view' | 'skip'; source: string; passage: Passage;
}

type HistoryItem = (BrowsingHistoryEntry & { kind: 'browsing' }) | (PushHistoryEntry & { kind: 'push' });

function parseTags(tags?: string) {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return tags.split(',').map(tag => tag.trim()).filter(Boolean);
  }
}

function itemSearchText(item: HistoryItem) {
  const tags = parseTags(item.passage.tags).join(' ');
  return [item.passage.text, item.passage.bookTitle, item.passage.author, tags]
    .join(' ')
    .toLowerCase();
}

export default function History() {
  const navigate = useNavigate();
  const [pushHistory, setPushHistory] = useState<PushHistoryEntry[]>([]);
  const [browsingHistory, setBrowsingHistory] = useState<BrowsingHistoryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'browsing' | 'push'>('browsing');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState('all');

  useEffect(() => {
    logtoClient.isAuthenticated().then(auth => {
      if (!auth) { navigate('/signin'); return; }
      Promise.all([apiFetch('/browsing/history'), apiFetch('/push/history')])
        .then(async ([browsingRes, pushRes]) => {
          const browsing = await browsingRes.json();
          const push = await pushRes.json();
          setBrowsingHistory(browsing.history || []);
          setPushHistory(push.history || []);
        })
        .finally(() => setLoading(false));
    });
  }, [navigate]);

  const currentItems = useMemo<HistoryItem[]>(() => (
    activeTab === 'browsing'
      ? browsingHistory.map(item => ({ ...item, kind: 'browsing' as const }))
      : pushHistory.map(item => ({ ...item, kind: 'push' as const }))
  ), [activeTab, browsingHistory, pushHistory]);

  const tags = useMemo(() => {
    const all = new Set<string>();
    for (const item of currentItems) parseTags(item.passage.tags).forEach(tag => all.add(tag));
    return Array.from(all).sort((a, b) => a.localeCompare(b));
  }, [currentItems]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return currentItems.filter(item => {
      if (needle && !itemSearchText(item).includes(needle)) return false;
      if (activeTag !== 'all' && !parseTags(item.passage.tags).includes(activeTag)) return false;
      return true;
    });
  }, [currentItems, query, activeTag]);

  const clearFilters = () => { setQuery(''); setActiveTag('all'); };

  return (
    <div className="min-h-screen bg-base-100 p-3 sm:p-4">
      <nav className="navbar bg-base-200 rounded-box mb-5 shadow">
        <div className="flex-1"><Link to="/discover" className="font-serif text-xl">📖 RandomPage</Link></div>
        <div className="flex-none gap-1 sm:gap-2">
          <Link to="/discover" className="btn btn-ghost btn-sm">Discover</Link>
          <Link to="/bookmarks" className="btn btn-ghost btn-sm">Bookmarks</Link>
          <Link to="/settings" className="btn btn-ghost btn-sm">Settings</Link>
        </div>
      </nav>
      <div className="max-w-2xl mx-auto pb-20">
        <div className="mb-4">
          <p className="text-xs uppercase tracking-[0.25em] opacity-50">Knowledge trail</p>
          <h2 className="text-2xl font-serif">📚 Reading History</h2>
        </div>
        <div className="tabs tabs-boxed mb-4">
          <button className={`tab ${activeTab === 'browsing' ? 'tab-active' : ''}`} onClick={() => { setActiveTab('browsing'); clearFilters(); }}>Browsing</button>
          <button className={`tab ${activeTab === 'push' ? 'tab-active' : ''}`} onClick={() => { setActiveTab('push'); clearFilters(); }}>Push inbox</button>
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
            {(query || activeTag !== 'all') && <button className="btn btn-link btn-xs self-start" onClick={clearFilters}>Clear filters</button>}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center"><span className="loading loading-spinner loading-lg" /></div>
        ) : currentItems.length === 0 ? (
          <div className="text-center opacity-60 py-10">
            <p>{activeTab === 'browsing' ? 'No browsing history yet. Read a few passages on Discover.' : 'No push inbox history yet. Enable notifications in Settings.'}</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-10">
            <p className="opacity-70">No matches in this history view.</p>
            <button className="btn btn-primary btn-sm mt-4" onClick={clearFilters}>Clear search</button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredItems.map(h => {
              const isBrowsing = h.kind === 'browsing';
              const isSkip = isBrowsing && h.action === 'skip';
              const isUnreadPush = h.kind === 'push' && !h.readAt;
              const tagsForItem = parseTags(h.passage.tags).slice(0, 4);
              return (
                <div key={`${h.kind}-${h.id}`} className={`card shadow ${isSkip ? 'bg-base-200 opacity-70' : isUnreadPush ? 'bg-base-300 border border-primary' : 'bg-base-300'}`}>
                  <div className="card-body py-3 gap-2">
                    <div className="flex items-center gap-2">
                      {isBrowsing ? (
                        <span className={`badge badge-xs ${isSkip ? 'badge-ghost' : 'badge-primary'}`}>{isSkip ? 'Skipped' : h.source === 'push_inbox' ? 'Read from push' : 'Viewed'}</span>
                      ) : !h.readAt ? <span className="badge badge-primary badge-xs">Unread</span> : <span className="badge badge-ghost badge-xs">Delivered</span>}
                      <span className="text-xs opacity-40">{new Date(isBrowsing ? h.createdAt : h.sentAt).toLocaleString()}</span>
                    </div>
                    <p className="font-serif text-sm leading-relaxed">{h.passage.text.slice(0, 170)}{h.passage.text.length > 170 ? '…' : ''}</p>
                    <div className="text-right opacity-50 text-xs">{h.passage.bookTitle} — {h.passage.author}</div>
                    {tagsForItem.length > 0 && <div className="flex flex-wrap gap-1">{tagsForItem.map(tag => <span key={tag} className="badge badge-ghost badge-xs">#{tag}</span>)}</div>}
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
