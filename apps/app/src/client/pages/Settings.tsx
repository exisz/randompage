import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logtoClient, redirectUri, postSignOutRedirectUri } from '../lib/logto';
import { apiFetch } from '../lib/api';

export default function Settings() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [vapidKey, setVapidKey] = useState('');

  useEffect(() => {
    logtoClient.isAuthenticated().then(auth => {
      setAuthed(auth);
      if (!auth) return;
      // Get VAPID public key
      fetch('/api/push/config')
        .then(r => r.json())
        .then(d => setVapidKey(d.publicKey || ''));
      // Check existing subscription
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        navigator.serviceWorker.ready.then(reg =>
          reg.pushManager.getSubscription().then(sub => setPushEnabled(!!sub))
        );
      }
    });
  }, []);

  const signOut = async () => {
    await logtoClient.signOut(postSignOutRedirectUri);
  };

  const signIn = async () => {
    await logtoClient.signIn(redirectUri);
  };

  const togglePush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Push notifications not supported in this browser.');
      return;
    }
    setPushLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (pushEnabled) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
        setPushEnabled(false);
      } else {
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKey,
        });
        const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        await apiFetch('/push/subscribe', {
          method: 'POST',
          body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth }),
        });
        setPushEnabled(true);
      }
    } catch (e) {
      console.error(e);
      alert('Push subscription failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPushLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-base-100 p-4">
      <nav className="navbar bg-base-200 rounded-box mb-6 shadow">
        <div className="flex-1"><Link to="/discover" className="font-serif text-xl">📖 RandomPage</Link></div>
        <div className="flex-none gap-2">
          <Link to="/discover" className="btn btn-ghost btn-sm">Discover</Link>
          <Link to="/bookmarks" className="btn btn-ghost btn-sm">Bookmarks</Link>
          <Link to="/history" className="btn btn-ghost btn-sm">History</Link>
        </div>
      </nav>
      <div className="max-w-md mx-auto">
        <h2 className="text-2xl font-serif mb-6">⚙️ Settings</h2>
        <div className="card bg-base-200 shadow mb-4">
          <div className="card-body gap-3">
            <h3 className="card-title text-base">Account</h3>
            {authed ? (
              <button className="btn btn-error btn-sm" onClick={signOut}>Sign out</button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={signIn}>Sign in</button>
            )}
          </div>
        </div>
        {authed && (
          <div className="card bg-base-200 shadow mb-4">
            <div className="card-body gap-3">
              <h3 className="card-title text-base">Push Notifications</h3>
              <p className="text-sm opacity-70">Get a random passage delivered daily.</p>
              <button
                className={`btn btn-sm ${pushEnabled ? 'btn-warning' : 'btn-primary'}`}
                onClick={togglePush}
                disabled={pushLoading || !vapidKey}
              >
                {pushLoading ? <span className="loading loading-spinner loading-xs" /> : null}
                {pushEnabled ? 'Disable notifications' : 'Enable daily push'}
              </button>
            </div>
          </div>
        )}
        <div className="card bg-base-200 shadow">
          <div className="card-body gap-2">
            <h3 className="card-title text-base">About</h3>
            <p className="text-sm opacity-60">
              RandomPage — a daily literary discovery app.<br />
              <a href="https://randompage.rollersoft.com.au" className="link" target="_blank" rel="noopener">randompage.rollersoft.com.au</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
