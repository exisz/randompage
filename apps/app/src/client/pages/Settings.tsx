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

type AvoidTagOption = {
  tag: string;
  count?: number;
};

type DailyPushSchedule = {
  hour: number;
  timeZone: string;
  windowHours: number;
  label: string;
};

type ReadLaterDestination = {
  email: string;
  active: boolean;
  verified: boolean;
  configured: boolean;
};

type OcrCandidate = {
  previewId: string;
  text: string;
  charCount: number;
  title: string;
  author: string;
  source: string;
  tags: string[];
  qualityNote: string;
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
  const [avoidTags, setAvoidTags] = useState<AvoidTagOption[]>([]);
  const [selectedAvoidTags, setSelectedAvoidTags] = useState<string[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [avoidLoading, setAvoidLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [readLaterLoading, setReadLaterLoading] = useState(false);
  const [dailyPushSchedule, setDailyPushSchedule] = useState<DailyPushSchedule | null>(null);
  const [readLaterDestination, setReadLaterDestination] = useState<ReadLaterDestination | null>(null);
  const [dailyPushHour, setDailyPushHour] = useState(() => new Date().getHours());
  const [dailyPushTimeZone, setDailyPushTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [readLaterEmail, setReadLaterEmail] = useState('');
  const [readLaterActive, setReadLaterActive] = useState(true);
  const [readLaterVerified, setReadLaterVerified] = useState(false);
  const [goalsStatus, setGoalsStatus] = useState('');
  const [avoidStatus, setAvoidStatus] = useState('');
  const [scheduleStatus, setScheduleStatus] = useState('');
  const [readLaterStatus, setReadLaterStatus] = useState('');
  const [ocrImageDataUrl, setOcrImageDataUrl] = useState('');
  const [ocrTitle, setOcrTitle] = useState('');
  const [ocrAuthor, setOcrAuthor] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [ocrCandidates, setOcrCandidates] = useState<OcrCandidate[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrStatus, setOcrStatus] = useState('');

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
          setAvoidTags(Array.isArray(d.avoidTags) ? d.avoidTags : []);
          setSelectedAvoidTags(Array.isArray(d.selectedAvoidTags) ? d.selectedAvoidTags : []);
          if (d.dailyPushSchedule && typeof d.dailyPushSchedule.hour === 'number') {
            setDailyPushSchedule(d.dailyPushSchedule);
            setDailyPushHour(d.dailyPushSchedule.hour);
            setDailyPushTimeZone(d.dailyPushSchedule.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
          }
          if (d.readLaterDestination) {
            setReadLaterDestination(d.readLaterDestination);
            setReadLaterEmail(d.readLaterDestination.email || '');
            setReadLaterActive(d.readLaterDestination.configured ? Boolean(d.readLaterDestination.active) : true);
            setReadLaterVerified(Boolean(d.readLaterDestination.verified));
          }
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


  const nextDailyPushLabel = useMemo(() => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(dailyPushHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: dailyPushTimeZone,
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(next);
    } catch {
      return `${String(dailyPushHour).padStart(2, '0')}:00 ${dailyPushTimeZone}`;
    }
  }, [dailyPushHour, dailyPushTimeZone]);

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

  const toggleAvoidTag = (tag: string) => {
    setAvoidStatus('');
    setSelectedAvoidTags(current => {
      if (current.includes(tag)) return current.filter(item => item !== tag);
      if (current.length >= 5) return current;
      return [...current, tag];
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
      setAvoidTags(Array.isArray(data.avoidTags) ? data.avoidTags : avoidTags);
      setSelectedAvoidTags(Array.isArray(data.selectedAvoidTags) ? data.selectedAvoidTags : selectedAvoidTags);
      setGoalsStatus('Saved — Discover will now weight fresh pages toward these topics.');
    } catch (e) {
      console.error(e);
      setGoalsStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setGoalsLoading(false);
    }
  };

  const saveAvoidTags = async () => {
    setAvoidLoading(true);
    setAvoidStatus('');
    try {
      const response = await apiFetch('/preferences/avoid-tags', {
        method: 'POST',
        body: JSON.stringify({ avoidTags: selectedAvoidTags }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Save failed');
      setPreferences(Array.isArray(data.preferences) ? data.preferences : []);
      setAvoidTags(Array.isArray(data.avoidTags) ? data.avoidTags : []);
      setSelectedAvoidTags(Array.isArray(data.selectedAvoidTags) ? data.selectedAvoidTags : []);
      setAvoidStatus(selectedAvoidTags.length > 0
        ? "Saved — we'll show fewer pages with these moods."
        : 'Saved — no avoid tags are active.');
    } catch (e) {
      console.error(e);
      setAvoidStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setAvoidLoading(false);
    }
  };


  const saveReadLaterDestination = async (clear = false) => {
    setReadLaterLoading(true);
    setReadLaterStatus('');
    try {
      const response = await apiFetch('/preferences/read-later-destination', {
        method: 'POST',
        body: JSON.stringify(clear ? { clear: true } : { email: readLaterEmail, active: readLaterActive, verified: readLaterVerified }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Save failed');
      setReadLaterDestination(data.readLaterDestination || null);
      if (clear) {
        setReadLaterEmail('');
        setReadLaterActive(true);
        setReadLaterVerified(false);
        setReadLaterStatus('Cleared — Email export is hidden until you save a destination again.');
      } else {
        setReadLaterEmail(data.readLaterDestination?.email || readLaterEmail);
        setReadLaterActive(Boolean(data.readLaterDestination?.active));
        setReadLaterVerified(Boolean(data.readLaterDestination?.verified));
        setReadLaterStatus('Saved — Bookmarks and source detail can prepare an email-ready saved-passage bundle.');
      }
    } catch (e) {
      console.error(e);
      setReadLaterStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setReadLaterLoading(false);
    }
  };

  const saveDailyPushSchedule = async () => {
    setScheduleLoading(true);
    setScheduleStatus('');
    try {
      const response = await apiFetch('/preferences/daily-push-schedule', {
        method: 'POST',
        body: JSON.stringify({ hour: dailyPushHour, timeZone: dailyPushTimeZone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Save failed');
      setDailyPushSchedule(data.dailyPushSchedule || null);
      setScheduleStatus('Saved — daily push will only send during this local hour unless QA uses override_schedule=1.');
    } catch (e) {
      console.error(e);
      setScheduleStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setScheduleLoading(false);
    }
  };


  const onOcrPhotoChange = (file: File | null) => {
    setOcrStatus('');
    setOcrCandidates([]);
    if (!file) {
      setOcrImageDataUrl('');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setOcrStatus('Choose a PNG, JPEG, or WebP page photo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setOcrImageDataUrl(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => setOcrStatus('Could not read that image file.');
    reader.readAsDataURL(file);
  };

  const previewPagePhotoOcr = async () => {
    if (!ocrImageDataUrl) {
      setOcrStatus('Choose one book-page photo first.');
      return;
    }
    setOcrLoading(true);
    setOcrStatus('');
    setOcrCandidates([]);
    try {
      const response = await apiFetch('/import/page-photo-ocr/preview', {
        method: 'POST',
        body: JSON.stringify({
          imageDataUrl: ocrImageDataUrl,
          title: ocrTitle,
          author: ocrAuthor,
          source: 'Private page photo',
          ocrText,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Preview failed');
      setOcrCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      if (data.status === 'candidate_preview') setOcrStatus('Preview ready — save only candidates you want in your private library.');
      else setOcrStatus(data.failure?.message || 'No readable candidates yet.');
    } catch (e) {
      console.error(e);
      setOcrStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setOcrLoading(false);
    }
  };

  const acceptOcrCandidate = async (candidate: OcrCandidate) => {
    setOcrLoading(true);
    setOcrStatus('');
    try {
      const response = await apiFetch('/import/page-photo-ocr/accept', {
        method: 'POST',
        body: JSON.stringify(candidate),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Save failed');
      setOcrStatus(`Saved privately to Bookmarks (${data.passage?.id || 'candidate'}). It will not enter public Discover automatically.`);
      setOcrCandidates(current => current.filter(item => item.previewId !== candidate.previewId));
    } catch (e) {
      console.error(e);
      setOcrStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setOcrLoading(false);
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
                <div className="divider my-1" />
                <div>
                  <h4 className="font-semibold text-sm">Avoid for now</h4>
                  <p className="text-sm opacity-70">
                    Pick moods or topics you want less of today. We'll show fewer pages with these moods, not a hard safety filter.
                  </p>
                </div>
                {avoidTags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {avoidTags.map(option => {
                      const selected = selectedAvoidTags.includes(option.tag);
                      const disabled = !selected && selectedAvoidTags.length >= 5;
                      return (
                        <button
                          key={option.tag}
                          type="button"
                          className={`btn btn-xs rounded-full ${selected ? 'btn-warning' : 'btn-outline'}`}
                          onClick={() => toggleAvoidTag(option.tag)}
                          disabled={disabled || avoidLoading}
                        >
                          {option.tag}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs opacity-60">Avoid tags will appear after the passage library syncs.</p>
                )}
                <button
                  className="btn btn-warning btn-sm"
                  onClick={saveAvoidTags}
                  disabled={avoidLoading}
                >
                  {avoidLoading ? <span className="loading loading-spinner loading-xs" /> : null}
                  Save avoid tags
                </button>
                {selectedAvoidTags.length > 0 ? (
                  <p className="text-xs opacity-60">Avoiding: {selectedAvoidTags.join(' · ')}</p>
                ) : null}
                {avoidStatus ? <p className="text-xs opacity-70">{avoidStatus}</p> : null}
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
              <div>
                <h3 className="card-title text-base">Kindle / read-later destination</h3>
                <p className="text-sm opacity-70">Save a private destination email once, then prepare saved-passage bundles from Bookmarks or source detail with one tap.</p>
              </div>
              <input
                className="input input-bordered input-sm"
                type="email"
                placeholder="your-kindle-name@kindle.com"
                value={readLaterEmail}
                onChange={(event) => { setReadLaterEmail(event.target.value); setReadLaterStatus(''); }}
              />
              <label className="label cursor-pointer justify-start gap-3 py-0">
                <input
                  type="checkbox"
                  className="toggle toggle-sm toggle-primary"
                  checked={readLaterActive}
                  onChange={(event) => { setReadLaterActive(event.target.checked); setReadLaterStatus(''); }}
                />
                <span className="label-text text-sm">Show Email export actions when this destination is active</span>
              </label>
              <label className="label cursor-pointer justify-start gap-3 py-0">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={readLaterVerified}
                  onChange={(event) => { setReadLaterVerified(event.target.checked); setReadLaterStatus(''); }}
                />
                <span className="label-text text-sm">I’ve approved this address in Kindle/read-later settings</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary btn-sm" onClick={() => saveReadLaterDestination(false)} disabled={readLaterLoading || !readLaterEmail.trim()}>
                  {readLaterLoading ? <span className="loading loading-spinner loading-xs" /> : null}
                  Save destination
                </button>
                <button className="btn btn-ghost btn-sm text-error" onClick={() => saveReadLaterDestination(true)} disabled={readLaterLoading || !(readLaterDestination?.configured || readLaterEmail.trim())}>Clear</button>
              </div>
              {readLaterDestination?.configured ? (
                <p className="text-xs opacity-70">Configured: {readLaterDestination.email} · {readLaterDestination.active ? 'active' : 'inactive'} · {readLaterDestination.verified ? 'approved' : 'approval not marked'}</p>
              ) : (
                <p className="text-xs opacity-60">No destination saved yet. Existing HTML/TXT/Copy export still works.</p>
              )}
              {readLaterStatus ? <p className="text-xs opacity-70">{readLaterStatus}</p> : null}
            </div>
          </div>
        )}
        {authed && (
          <div className="card bg-base-200 shadow mb-4">
            <div className="card-body gap-3">
              <div>
                <h3 className="card-title text-base">Page photo import (private)</h3>
                <p className="text-sm opacity-70">Upload one physical book-page photo, preview 1–3 RandomPage-shaped candidates, then save only reviewed snippets to your private Bookmarks. Private OCR candidates are tagged out of public Discover.</p>
              </div>
              <input
                className="file-input file-input-bordered file-input-sm w-full"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => onOcrPhotoChange(event.target.files?.[0] || null)}
              />
              <div className="grid grid-cols-2 gap-2">
                <input className="input input-bordered input-sm" placeholder="Book title" value={ocrTitle} onChange={(event) => setOcrTitle(event.target.value)} />
                <input className="input input-bordered input-sm" placeholder="Author" value={ocrAuthor} onChange={(event) => setOcrAuthor(event.target.value)} />
              </div>
              <textarea
                className="textarea textarea-bordered min-h-28 text-sm"
                placeholder="Optional OCR text from your device/browser. If the photo is unreadable, paste extracted text here to generate private candidates."
                value={ocrText}
                onChange={(event) => setOcrText(event.target.value)}
              />
              <button className="btn btn-primary btn-sm" onClick={previewPagePhotoOcr} disabled={ocrLoading || !ocrImageDataUrl}>
                {ocrLoading ? <span className="loading loading-spinner loading-xs" /> : null}
                Preview private candidates
              </button>
              {ocrStatus ? <p className="text-xs opacity-70">{ocrStatus}</p> : null}
              {ocrCandidates.length > 0 ? (
                <div className="grid gap-3">
                  {ocrCandidates.map(candidate => (
                    <div key={candidate.previewId} className="rounded-box border border-base-300 bg-base-100 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="badge badge-primary badge-outline">private/import-candidate</span>
                        <span className="text-xs opacity-60">{candidate.charCount} chars</span>
                      </div>
                      <p className="font-serif text-sm leading-relaxed">{candidate.text}</p>
                      <p className="mt-2 text-xs opacity-60">{candidate.title} · {candidate.author} · {candidate.qualityNote}</p>
                      <button className="btn btn-secondary btn-xs mt-3" onClick={() => acceptOcrCandidate(candidate)} disabled={ocrLoading}>Save to private Bookmarks</button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )}
        {authed && (
          <div className="card bg-base-200 shadow mb-4">
            <div className="card-body gap-3">
              <h3 className="card-title text-base">Push Notifications</h3>
              <p className="text-sm opacity-70">Get a personalized passage delivered daily.</p>
              <div className="rounded-box border border-base-300 bg-base-100 p-3">
                <label className="label py-1"><span className="label-text text-sm font-semibold">Daily passage time</span></label>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input
                    type="time"
                    className="input input-bordered input-sm"
                    value={`${String(dailyPushHour).padStart(2, '0')}:00`}
                    onChange={(event) => { setDailyPushSchedule(null); setScheduleStatus(''); setDailyPushHour(Number(event.target.value.slice(0, 2))); }}
                  />
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={saveDailyPushSchedule}
                    disabled={scheduleLoading}
                  >
                    {scheduleLoading ? <span className="loading loading-spinner loading-xs" /> : null}
                    Save time
                  </button>
                </div>
                <input
                  className="input input-bordered input-xs mt-2 w-full"
                  value={dailyPushTimeZone}
                  onChange={(event) => { setDailyPushSchedule(null); setScheduleStatus(''); setDailyPushTimeZone(event.target.value); }}
                  aria-label="Daily push time zone"
                />
                <p className="mt-2 text-xs opacity-70">
                  Next daily page: {dailyPushSchedule ? dailyPushSchedule.label : nextDailyPushLabel}.
                </p>
                {scheduleStatus ? <p className="mt-1 text-xs opacity-70">{scheduleStatus}</p> : null}
              </div>
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
