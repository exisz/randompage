import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { logtoClient, redirectUri, postSignOutRedirectUri } from '../lib/logto';
import { apiFetch } from '../lib/api';

type ReadingGoal = {
  id: string;
  label: string;
  tags: string[];
};

type UserPreference = {
  id: string;
  tag: string;
  weight: number;
};

const FALLBACK_READING_GOALS: ReadingGoal[] = [
  {
    id: 'reflective-philosophy',
    label: 'Reflective philosophy',
    tags: ['philosophy', 'philosophical-fiction', 'morality', 'human-nature', 'contemplative'],
  },
  {
    id: 'inner-life-psychology',
    label: 'Inner life & psychology',
    tags: ['psychology', 'self-cultivation', 'relationships', 'love', 'suffering'],
  },
  {
    id: 'history-society',
    label: 'History & society',
    tags: ['history', 'power', 'critique', 'social-interaction', 'freedom'],
  },
  {
    id: 'literary-classics',
    label: 'Literary classics',
    tags: ['literature', 'fiction', 'symbolism', 'adventure', 'nature'],
  },
  {
    id: 'mystery-tension',
    label: 'Mystery & tension',
    tags: ['mystery', 'investigation', 'tense', 'dark', 'deception'],
  },
];

export default function Settings() {
  const [authed, setAuthed] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [vapidKey, setVapidKey] = useState('');
  const [readingGoals, setReadingGoals] = useState<ReadingGoal[]>(FALLBACK_READING_GOALS);
  const [selectedGoalIds, setSelectedGoalIds] = useState<string[]>([]);
  const [preferences, setPreferences] = useState<UserPreference[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [goalsStatus, setGoalsStatus] = useState('');

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
      apiFetch('/preferences')
        .then(r => r.json())
        .then(d => {
          const nextGoals = Array.isArray(d.readingGoals) ? d.readingGoals : FALLBACK_READING_GOALS;
          const nextPrefs = Array.isArray(d.preferences) ? d.preferences : [];
          setReadingGoals(nextGoals);
          setPreferences(nextPrefs);
          const prefTags = new Set(nextPrefs.filter((pref: UserPreference) => Number(pref.weight) >= 7).map((pref: UserPreference) => pref.tag));
          const inferredGoals = nextGoals
            .filter((goal: ReadingGoal) => goal.tags.some((tag) => prefTags.has(tag)))
            .slice(0, 3)
            .map((goal: ReadingGoal) => goal.id);
          setSelectedGoalIds(inferredGoals);
        })
        .catch(e => {
          console.error(e);
          setGoalsStatus('Could not load personalization yet.');
        });
    });
  }, []);

  const topPreferenceTags = useMemo(
    () => preferences.slice(0, 10).map(pref => `${pref.tag} ${pref.weight}`),
    [preferences],
  );

  const signOut = async () => {
    await logtoClient.signOut(postSignOutRedirectUri);
  };

  const signIn = async () => {
    await logtoClient.signIn(redirectUri);
  };

  const toggleGoal = (goalId: string) => {
    setGoalsStatus('');
    setSelectedGoalIds(current => {
      if (current.includes(goalId)) return current.filter(id => id !== goalId);
      if (current.length >= 3) return current;
      return [...current, goalId];
    });
  };

  const saveReadingGoals = async () => {
    if (selectedGoalIds.length < 1 || selectedGoalIds.length > 3) {
      setGoalsStatus('Choose 1–3 reading goals first.');
      return;
    }
    setGoalsLoading(true);
    setGoalsStatus('');
    try {
      const response = await apiFetch('/preferences/goals', {
        method: 'POST',
        body: JSON.stringify({ goalIds: selectedGoalIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Save failed');
      setPreferences(Array.isArray(data.preferences) ? data.preferences : []);
      setGoalsStatus('Saved — Discover will now weight fresh pages toward these topics.');
    } catch (e) {
      console.error(e);
      setGoalsStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setGoalsLoading(false);
    }
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
          <Link to="/today" className="btn btn-ghost btn-sm">Today</Link>
          <Link to="/bookmarks" className="btn btn-ghost btn-sm">Bookmarks</Link>
          <Link to="/history" className="btn btn-ghost btn-sm">History</Link>
        </div>
      </nav>
      <div className="max-w-md mx-auto">
        <h2 className="text-2xl font-serif mb-6">⚙️ Settings</h2>
        <div className="card overflow-hidden border border-primary/20 bg-primary/10 shadow mb-4">
          <div className="card-body gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="card-title text-base">Today shortcut</h3>
                <p className="text-sm opacity-70">
                  Open a widget-like daily passage surface from your home screen. Add RandomPage to your phone home screen, then use Today for the latest pushed or personalized page.
                </p>
              </div>
              <span className="badge badge-primary badge-outline shrink-0">PWA</span>
            </div>
            <Link to="/today" className="btn btn-primary btn-sm rounded-2xl">Open Today page</Link>
          </div>
        </div>
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
        <div className="card bg-base-200 shadow mb-4">
          <div className="card-body gap-3">
            <div>
              <h3 className="card-title text-base">Personalization / Reading goals</h3>
              <p className="text-sm opacity-70">
                Choose 1–3 topics so RandomPage can seed your preference weights before it learns from your reading.
              </p>
            </div>
            {authed ? (
              <>
                <div className="grid gap-2">
                  {readingGoals.map(goal => {
                    const selected = selectedGoalIds.includes(goal.id);
                    const disabled = !selected && selectedGoalIds.length >= 3;
                    return (
                      <button
                        key={goal.id}
                        type="button"
                        className={`btn h-auto min-h-0 justify-start whitespace-normal py-3 text-left ${selected ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => toggleGoal(goal.id)}
                        disabled={disabled || goalsLoading}
                      >
                        <span>
                          <span className="block font-semibold">{goal.label}</span>
                          <span className="block text-xs opacity-75">{goal.tags.slice(0, 5).join(' · ')}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={saveReadingGoals}
                  disabled={goalsLoading || selectedGoalIds.length < 1}
                >
                  {goalsLoading ? <span className="loading loading-spinner loading-xs" /> : null}
                  Save reading goals
                </button>
                {topPreferenceTags.length > 0 ? (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {topPreferenceTags.map(tag => <span key={tag} className="badge badge-ghost">{tag}</span>)}
                  </div>
                ) : (
                  <p className="text-xs opacity-60">No preference weights yet — save goals or read/bookmark passages to start learning.</p>
                )}
                {goalsStatus ? <p className="text-xs opacity-70">{goalsStatus}</p> : null}
              </>
            ) : (
              <div className="rounded-box border border-dashed border-base-300 p-3">
                <p className="text-sm opacity-70 mb-3">Sign in to save reading goals and personalize Discover.</p>
                <button className="btn btn-primary btn-sm" onClick={signIn}>Sign in to personalize</button>
              </div>
            )}
          </div>
        </div>
        {authed && (
          <div className="card bg-base-200 shadow mb-4">
            <div className="card-body gap-3">
              <h3 className="card-title text-base">Push Notifications</h3>
              <p className="text-sm opacity-70">Get a personalized passage delivered daily.</p>
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
