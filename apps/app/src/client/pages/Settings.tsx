import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logtoClient, redirectUri, postSignOutRedirectUri } from '../lib/logto';
import { apiFetch } from '../lib/api';
import AppShell from '../components/AppShell';

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
      fetch('/api/push/config')
        .then(r => r.json())
        .then(d => setVapidKey(d.publicKey || ''));
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
    <AppShell
      eyebrow="Device controls"
      title="Tune the daily ritual."
      subtitle="Account, push delivery, and app install metadata for the RandomPage phone surface."
      maxWidth="max-w-md"
    >
      <div className="flex flex-col gap-4">
        <section className="rp-glass-card p-5">
          <h2 className="text-lg font-bold">Account</h2>
          <p className="mt-1 text-sm opacity-60">Sign in to sync your shelf, history, and recommendation weights.</p>
          {authed ? (
            <button className="btn btn-error mt-4 w-full" onClick={signOut}>Sign out</button>
          ) : (
            <button className="btn btn-primary mt-4 w-full" onClick={signIn}>Sign in</button>
          )}
        </section>

        {authed && (
          <section className="rp-glass-card p-5">
            <h2 className="text-lg font-bold">Push Notifications</h2>
            <p className="mt-1 text-sm opacity-60">Get one personalized passage delivered daily.</p>
            <button
              className={`btn mt-4 w-full ${pushEnabled ? 'btn-warning' : 'btn-primary'}`}
              onClick={togglePush}
              disabled={pushLoading || !vapidKey}
            >
              {pushLoading ? <span className="loading loading-spinner loading-xs" /> : null}
              {pushEnabled ? 'Disable notifications' : 'Enable daily push'}
            </button>
          </section>
        )}

        <section className="rp-glass-card p-5">
          <h2 className="text-lg font-bold">Android shell</h2>
          <p className="mt-1 text-sm opacity-60">
            RandomPage is prepared as a native-feeling Android wrapper around the production PWA.
          </p>
          <Link to="/discover" className="btn btn-ghost mt-4 w-full">Return to reading</Link>
        </section>

        <section className="rp-glass-card p-5">
          <h2 className="text-lg font-bold">About</h2>
          <p className="mt-1 text-sm opacity-60">
            RandomPage — a personal literary discovery engine.<br />
            <a href="https://randompage.rollersoft.com.au" className="link link-warning" target="_blank" rel="noopener">randompage.rollersoft.com.au</a>
          </p>
        </section>
      </div>
    </AppShell>
  );
}
