import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logtoClient } from '../lib/logto';
import { apiFetch } from '../lib/api';
import AppShell from '../components/AppShell';

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
    <AppShell
      eyebrow="Shelf memory"
      title="Saved pages stay close."
      subtitle="Your shelf is the explicit signal that teaches RandomPage what to bring back next."
    >
      {loading ? (
        <div className="rp-glass-card p-8 text-center"><span className="loading loading-spinner loading-lg text-warning" /></div>
      ) : bookmarks.length === 0 ? (
        <div className="rp-glass-card p-8 text-center">
          <p className="opacity-65">No bookmarks yet.</p>
          <Link to="/discover" className="btn btn-primary mt-5">Discover passages</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {bookmarks.map(bm => (
            <article key={bm.id} className="rp-glass-card rp-list-card p-5">
              <p className="font-serif text-base leading-relaxed text-base-content/90">{bm.passage.text.slice(0, 220)}{bm.passage.text.length > 220 ? '…' : ''}</p>
              <div className="rp-meta mt-4 text-right">{bm.passage.bookTitle} — {bm.passage.author}</div>
              <div className="mt-4 flex justify-end">
                <button className="btn btn-ghost btn-xs text-error" onClick={() => removeBookmark(bm.id)}>Remove</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
