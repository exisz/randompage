import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logtoClient } from '../lib/logto';
import { apiFetch } from '../lib/api';

interface Passage {
  id: string; text: string; bookTitle: string; author: string;
}
interface HistoryEntry {
  id: string; sentAt: string; readAt: string | null; passage: Passage;
}

export default function History() {
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logtoClient.isAuthenticated().then(auth => {
      if (!auth) { navigate('/signin'); return; }
      apiFetch('/push/history')
        .then(r => r.json())
        .then(d => setHistory(d.history || []))
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
        <h2 className="text-2xl font-serif mb-4">📬 Push History</h2>
        {loading ? (
          <div className="flex justify-center"><span className="loading loading-spinner loading-lg" /></div>
        ) : history.length === 0 ? (
          <div className="text-center opacity-60 py-10">
            <p>No push history yet. Enable notifications in Settings.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {history.map(h => (
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
