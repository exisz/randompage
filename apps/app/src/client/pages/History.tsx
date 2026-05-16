import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { logtoClient } from '../lib/logto';
import { apiFetch } from '../lib/api';
import AppShell from '../components/AppShell';

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
    <AppShell
      eyebrow="Signal log"
      title="Your trail shapes the engine."
      subtitle="Views, skips, and push reads are kept as personal context for the next recommendation."
    >
      <div className="rp-glass-card p-3">
        <div className="grid grid-cols-2 gap-2">
          <button className={`btn rounded-2xl ${activeTab === 'browsing' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('browsing')}>Browsing</button>
          <button className={`btn rounded-2xl ${activeTab === 'push' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('push')}>Push inbox</button>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="rp-glass-card p-8 text-center"><span className="loading loading-spinner loading-lg text-warning" /></div>
        ) : activeTab === 'browsing' ? (
          browsingHistory.length === 0 ? (
            <div className="rp-glass-card p-8 text-center opacity-70">No browsing history yet. Read a few passages on Discover.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {browsingHistory.map(h => (
                <article key={h.id} className={`rp-glass-card rp-list-card p-4 ${h.action === 'skip' ? 'opacity-70' : ''}`}>
                  <span className={`badge badge-xs mb-3 ${h.action === 'skip' ? 'badge-ghost' : 'badge-primary'}`}>{h.action === 'skip' ? 'Skipped' : h.source === 'push_inbox' ? 'Read from push' : 'Viewed'}</span>
                  <p className="font-serif text-sm leading-relaxed">{h.passage.text.slice(0, 160)}…</p>
                  <div className="rp-meta mt-3 text-right text-xs">{h.passage.bookTitle} — {h.passage.author}</div>
                  <div className="mt-2 text-xs opacity-40">{new Date(h.createdAt).toLocaleString()}</div>
                </article>
              ))}
            </div>
          )
        ) : pushHistory.length === 0 ? (
          <div className="rp-glass-card p-8 text-center opacity-70">No push inbox history yet. Enable notifications in Settings.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {pushHistory.map(h => (
              <article key={h.id} className={`rp-glass-card rp-list-card p-4 ${h.readAt ? 'opacity-70' : 'ring-1 ring-warning/35'}`}>
                {!h.readAt && <span className="badge badge-primary badge-xs mb-3">Unread</span>}
                <p className="font-serif text-sm leading-relaxed">{h.passage.text.slice(0, 160)}…</p>
                <div className="rp-meta mt-3 text-right text-xs">{h.passage.bookTitle} — {h.passage.author}</div>
                <div className="mt-2 text-xs opacity-40">{new Date(h.sentAt).toLocaleDateString()}</div>
              </article>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
