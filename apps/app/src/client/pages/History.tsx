import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logtoClient } from '../lib/logto';
import { apiFetch } from '../lib/api';

interface Passage {
  id: string; text: string; bookTitle: string; author: string;
}
interface PushHistoryEntry {
  id: string; sentAt: string; readAt: string | null; passage: Passage;
}
interface BrowsingHistoryEntry {
  id: string; createdAt: string; action: 'view' | 'skip'; source: string; passage: Passage;
}

export default function History() {
  const navigate = useNavigate();
  const [pushHistory, setPushHistory] = useState<PushHistoryEntry[]>([]);
  const [browsingHistory, setBrowsingHistory] = useState<BrowsingHistoryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'browsing' | 'push'>('browsing');
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="min-h-screen bg-base-100 p-4">
      <nav className="navbar bg-base-200 rounded-box mb-6 shadow">
        <div className="flex-1"><Link to="/discover" className="font-serif text-xl">📖 RandomPage</Link></div>
        <div className="flex-none gap-2">
          <Link to="/discover" className="btn btn-ghost btn-sm">Discover</Link>
          <Link to="/bookmarks" className="btn btn-ghost btn-sm">Bookmarks</Link>
          <Link to="/settings" className="btn btn-ghost btn-sm">Settings</Link>
        </div>
      </nav>
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-serif mb-4">📚 Reading History</h2>
        <div className="tabs tabs-boxed mb-4">
          <button className={`tab ${activeTab === 'browsing' ? 'tab-active' : ''}`} onClick={() => setActiveTab('browsing')}>Browsing</button>
          <button className={`tab ${activeTab === 'push' ? 'tab-active' : ''}`} onClick={() => setActiveTab('push')}>Push inbox</button>
        </div>
        {loading ? (
          <div className="flex justify-center"><span className="loading loading-spinner loading-lg" /></div>
        ) : activeTab === 'browsing' ? (
          browsingHistory.length === 0 ? (
            <div className="text-center opacity-60 py-10">
              <p>No browsing history yet. Read a few passages on Discover.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {browsingHistory.map(h => (
                <div key={h.id} className={`card shadow ${h.action === 'skip' ? 'bg-base-200 opacity-70' : 'bg-base-300'}`}>
                  <div className="card-body py-3 gap-1">
                    <span className={`badge badge-xs mb-1 ${h.action === 'skip' ? 'badge-ghost' : 'badge-primary'}`}>{h.action === 'skip' ? 'Skipped' : h.source === 'push_inbox' ? 'Read from push' : 'Viewed'}</span>
                    <p className="font-serif text-sm leading-relaxed">{h.passage.text.slice(0, 150)}…</p>
                    <div className="text-right opacity-50 text-xs">{h.passage.bookTitle} — {h.passage.author}</div>
                    <div className="text-xs opacity-40">{new Date(h.createdAt).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : pushHistory.length === 0 ? (
          <div className="text-center opacity-60 py-10">
            <p>No push inbox history yet. Enable notifications in Settings.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pushHistory.map(h => (
              <div key={h.id} className={`card shadow ${h.readAt ? 'bg-base-200 opacity-70' : 'bg-base-300 border border-primary'}`}>
                <div className="card-body py-3 gap-1">
                  {!h.readAt && <span className="badge badge-primary badge-xs mb-1">Unread</span>}
                  <p className="font-serif text-sm leading-relaxed">{h.passage.text.slice(0, 150)}…</p>
                  <div className="text-right opacity-50 text-xs">{h.passage.bookTitle} — {h.passage.author}</div>
                  <div className="text-xs opacity-40">{new Date(h.sentAt).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
