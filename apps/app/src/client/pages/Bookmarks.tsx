import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logtoClient } from '../lib/logto';
import { apiFetch } from '../lib/api';

interface Passage {
  id: string; text: string; bookTitle: string; author: string; chapter?: string; tags: string;
}
interface Bookmark {
  id: string; createdAt: string; passage: Passage;
}

export default function Bookmarks() {
  const navigate = useNavigate();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logtoClient.isAuthenticated().then(auth => {
      if (!auth) { navigate('/signin'); return; }
      apiFetch('/bookmarks')
        .then(r => r.json())
        .then(d => setBookmarks(d.bookmarks || []))
        .finally(() => setLoading(false));
    });
  }, [navigate]);

  const removeBookmark = async (id: string) => {
    await apiFetch(`/bookmarks/${id}`, { method: 'DELETE' });
    setBookmarks(b => b.filter(bm => bm.id !== id));
  };

  return (
    <div className="min-h-screen bg-base-100 p-4">
      <nav className="navbar bg-base-200 rounded-box mb-6 shadow">
        <div className="flex-1"><Link to="/discover" className="font-serif text-xl">📖 RandomPage</Link></div>
        <div className="flex-none gap-2">
          <Link to="/discover" className="btn btn-ghost btn-sm">Discover</Link>
          <Link to="/history" className="btn btn-ghost btn-sm">History</Link>
          <Link to="/settings" className="btn btn-ghost btn-sm">Settings</Link>
        </div>
      </nav>
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-serif mb-4">🔖 Bookmarks</h2>
        {loading ? (
          <div className="flex justify-center"><span className="loading loading-spinner loading-lg" /></div>
        ) : bookmarks.length === 0 ? (
          <div className="text-center opacity-60 py-10">
            <p>No bookmarks yet.</p>
            <Link to="/discover" className="btn btn-primary btn-sm mt-4">Discover passages</Link>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {bookmarks.map(bm => (
              <div key={bm.id} className="card bg-base-200 shadow">
                <div className="card-body gap-2 py-4">
                  <p className="font-serif leading-relaxed">{bm.passage.text.slice(0, 200)}{bm.passage.text.length > 200 ? '…' : ''}</p>
                  <div className="text-right opacity-60 text-sm">{bm.passage.bookTitle} — {bm.passage.author}</div>
                  <div className="card-actions justify-end">
                    <button className="btn btn-ghost btn-xs text-error" onClick={() => removeBookmark(bm.id)}>Remove</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
