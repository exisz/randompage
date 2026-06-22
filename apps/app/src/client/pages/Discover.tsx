import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { logtoClient } from '../lib/logto';
import { apiFetch } from '../lib/api';
import { isOfflineError, useOnlineStatus } from '../lib/offline';
import ListenControl from '../components/ListenControl';
import SharePassageButton from '../components/SharePassageButton';
import SharePassageImageButton from '../components/SharePassageImageButton';
import PassageFeedbackChips from '../components/PassageFeedbackChips';
import { addPassageToReadingQueue, isPassageQueued } from '../lib/readingQueue';
import { formatReviewScheduleFeedback, type ReviewSchedulePayload } from '../lib/reviewScheduleFeedback';
import BookSourceLink from '../components/BookSourceLink';

interface Passage {
  id: string;
  text: string;
  bookTitle: string;
  author: string;
  chapter?: string;
  tags: string;
  language: string;
}

interface ReadingStats {
  todayCount: number;
  streakDays: number;
}

interface RecommendationExplanation {
  label: 'High match' | 'Good match';
  reason: string;
  matchedTags: string[];
  score: number;
}

interface DailyQueueItem extends Passage {
  queuePosition: number;
  whyPersonalized?: RecommendationExplanation | null;
}

interface DailyQueue {
  queue: DailyQueueItem[];
  generatedFor: string;
  freshOnly: boolean;
  fallbackUsed: boolean;
  strategy: string;
  emptyReason: string | null;
}

interface ReadingPathGoal {
  id: string;
  label: string;
  tags: string[];
}

interface ReadingPathEntry {
  day: number;
  passage: Passage;
  reason: string;
}

interface ReadingPath {
  id: string;
  topic: string;
  goalId: string | null;
  currentDay: number;
  totalDays: number;
  current: ReadingPathEntry | null;
  upcoming: ReadingPathEntry[];
  queue: ReadingPathEntry[];
}

interface ReadingPathResponse {
  path: ReadingPath | null;
  goals: ReadingPathGoal[];
}

interface DailyReviewItem {
  id: string;
  bookmarkId: string;
  passageId: string;
  reviewPosition: number;
  lastReviewedAt: string | null;
  note?: string | null;
  passage: Passage;
}

interface DailyReview {
  items: DailyReviewItem[];
  generatedFor: string;
}

interface UnreadPushSummary {
  count: number;
  latest: {
    id: string;
    sentAt: string;
    passage: Passage;
  } | null;
}


interface ReadingChallenge {
  id: string;
  label: string;
  description: string;
  count: number;
  target: number;
  unit: string;
  complete: boolean;
  percent: number;
  href?: string;
  emptyHint: string;
}

interface ReadingChallengesResponse {
  challenges: ReadingChallenge[];
  generatedFor: string;
  summary: {
    complete: number;
    total: number;
    unreadPushCount: number;
    favoriteTag: string | null;
  };
}

type QueuePlaybackState = 'idle' | 'playing' | 'paused';

const HIDDEN_TAGS = new Set(['en', 'zh', 'ja', 'fr', 'de', 'es', 'other']);

function parsePassageTags(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : (() => {
    const text = raw.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall back to legacy comma-delimited tags below.
    }
    return text.split(',');
  })();

  return values
    .map((tag) => String(tag).trim().replace(/^[\s\[\]"']+|[\s\[\]"']+$/g, ''))
    .filter(Boolean)
    .filter((tag) => !HIDDEN_TAGS.has(tag.toLowerCase()))
    .filter((tag, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === tag.toLowerCase()) === index);
}

function shortExcerpt(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 220
    ? `${normalized.slice(0, 220).trim()}…`
    : normalized;
}

function passageErrorMessage(status: number) {
  if (status === 401 || status === 403) return 'Session expired — sign in again or continue with public passages.';
  if (status >= 500) return 'Could not load your personalized passage. Showing the public feed instead.';
  return `Could not load passage (HTTP ${status}). Try again.`;
}

function passageAccent(tags: string[]) {
  const tagText = tags.join(' ').toLowerCase();
  if (/history|war|politic|power|empire/.test(tagText)) return 'from-amber-300/25 via-stone-900 to-base-200';
  if (/philosophy|psychology|mind|wisdom/.test(tagText)) return 'from-cyan-300/20 via-slate-900 to-base-200';
  if (/romance|love|family|heart/.test(tagText)) return 'from-rose-300/25 via-zinc-900 to-base-200';
  if (/adventure|travel|sea|quest/.test(tagText)) return 'from-emerald-300/20 via-neutral-900 to-base-200';
  return 'from-primary/25 via-base-300 to-base-200';
}

function speechQueueAvailable() {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && 'SpeechSynthesisUtterance' in window;
}

export default function Discover() {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [whyPersonalized, setWhyPersonalized] = useState<RecommendationExplanation | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookmarked, setBookmarked] = useState(false);
  const [queued, setQueued] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [dailyQueue, setDailyQueue] = useState<DailyQueue | null>(null);
  const [readingPath, setReadingPath] = useState<ReadingPath | null>(null);
  const [readingPathGoals, setReadingPathGoals] = useState<ReadingPathGoal[]>([]);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathStatus, setPathStatus] = useState<string | null>(null);
  const [dailyReview, setDailyReview] = useState<DailyReview | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [queuePlayback, setQueuePlayback] = useState<QueuePlaybackState>('idle');
  const [queueActiveIndex, setQueueActiveIndex] = useState<number | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [unreadPush, setUnreadPush] = useState<UnreadPushSummary>({ count: 0, latest: null });
  const [readingChallenges, setReadingChallenges] = useState<ReadingChallengesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const online = useOnlineStatus();
  const [topTags, setTopTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTagState] = useState<string | null>(() => {
    try { return localStorage.getItem('discover_tag_filter') || null; } catch { return null; }
  });
  const selectedTagRef = useRef<string | null>(null);
  const dailyQueueUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Keep ref in sync with state for use inside useCallback closures
  useEffect(() => { selectedTagRef.current = selectedTag; }, [selectedTag]);

  useEffect(() => () => {
    if (dailyQueueUtteranceRef.current && speechQueueAvailable()) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const setSelectedTag = useCallback((tag: string | null) => {
    selectedTagRef.current = tag;
    setSelectedTagState(tag);
    try {
      if (tag) localStorage.setItem('discover_tag_filter', tag);
      else localStorage.removeItem('discover_tag_filter');
    } catch { /* ignore */ }
  }, []);

  const [searchParams] = useSearchParams();
  const pushPassageId = searchParams.get('passageId');
  const pushSource = searchParams.get('source');

  const fetchTopTags = useCallback(async () => {
    try {
      const res = await fetch('/api/passages/tags?limit=12');
      if (!res.ok) throw new Error(`tags ${res.status}`);
      const data = await res.json() as { tags: Array<{ tag: string }> };
      setTopTags(data.tags.map((t) => t.tag));
    } catch (e) {
      console.error(e);
      setTopTags([]);
    }
  }, []);

  const fetchDailyQueue = useCallback(async () => {
    try {
      const isAuth = await logtoClient.isAuthenticated();
      if (!isAuth) {
        setDailyQueue(null);
        return;
      }
      const res = await apiFetch('/passages/daily-queue?limit=5');
      if (!res.ok) throw new Error(`Daily queue returned ${res.status}`);
      const data = await res.json();
      setDailyQueue({
        queue: Array.isArray(data.queue) ? data.queue : [],
        generatedFor: data.generatedFor ?? '',
        freshOnly: Boolean(data.freshOnly),
        fallbackUsed: Boolean(data.fallbackUsed),
        strategy: typeof data.strategy === 'string' ? data.strategy : '',
        emptyReason: typeof data.emptyReason === 'string' ? data.emptyReason : null,
      });
    } catch (e) {
      console.error(e);
      setDailyQueue({
        queue: [],
        generatedFor: '',
        freshOnly: false,
        fallbackUsed: false,
        strategy: 'load_error',
        emptyReason: 'Could not load your daily queue. Check your connection and try Refresh queue.',
      });
    }
  }, []);

  const fetchReadingPath = useCallback(async () => {
    try {
      const isAuth = await logtoClient.isAuthenticated();
      if (!isAuth) {
        setReadingPath(null);
        setReadingPathGoals([]);
        return;
      }
      const res = await apiFetch('/reading-path');
      if (!res.ok) throw new Error(`Reading path returned ${res.status}`);
      const data = await res.json() as ReadingPathResponse;
      setReadingPath(data.path ?? null);
      setReadingPathGoals(Array.isArray(data.goals) ? data.goals : []);
    } catch (e) {
      console.error(e);
      setReadingPath(null);
      setPathStatus('Could not load your reading path yet.');
    }
  }, []);

  const fetchReadingChallenges = useCallback(async () => {
    try {
      const isAuth = await logtoClient.isAuthenticated();
      if (!isAuth) {
        setReadingChallenges(null);
        return;
      }
      const res = await apiFetch('/reading/challenges');
      if (!res.ok) throw new Error(`Reading challenges returned ${res.status}`);
      const data = await res.json() as ReadingChallengesResponse;
      setReadingChallenges({
        challenges: Array.isArray(data.challenges) ? data.challenges : [],
        generatedFor: data.generatedFor ?? '',
        summary: data.summary ?? { complete: 0, total: 0, unreadPushCount: 0, favoriteTag: null },
      });
    } catch (e) {
      console.error(e);
      setReadingChallenges(null);
    }
  }, []);

  const startReadingPath = useCallback(async (goalId: string) => {
    setPathLoading(true);
    setPathStatus(null);
    try {
      const res = await apiFetch('/reading-path/start', {
        method: 'POST',
        body: JSON.stringify({ goalId }),
      });
      const data = await res.json() as ReadingPathResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `Reading path returned ${res.status}`);
      setReadingPath(data.path ?? null);
      setReadingPathGoals(Array.isArray(data.goals) ? data.goals : readingPathGoals);
      void fetchReadingChallenges();
      setPathStatus('7-day path started from existing RandomPage passages.');
    } catch (e) {
      console.error(e);
      setPathStatus(e instanceof Error ? e.message : 'Could not start reading path.');
    } finally {
      setPathLoading(false);
    }
  }, [fetchReadingChallenges, readingPathGoals]);

  const fetchDailyReview = useCallback(async () => {
    try {
      const isAuth = await logtoClient.isAuthenticated();
      if (!isAuth) {
        setDailyReview(null);
        return;
      }
      const res = await apiFetch('/daily-review');
      if (!res.ok) throw new Error(`Daily review returned ${res.status}`);
      const data = await res.json();
      setDailyReview({
        items: Array.isArray(data.items) ? data.items : [],
        generatedFor: data.generatedFor ?? '',
      });
    } catch (e) {
      console.error(e);
      setDailyReview(null);
    }
  }, []);

  const fetchUnreadPush = useCallback(async () => {
    try {
      const isAuth = await logtoClient.isAuthenticated();
      if (!isAuth) {
        setUnreadPush({ count: 0, latest: null });
        return;
      }
      const res = await apiFetch('/push/history');
      if (!res.ok) throw new Error(`Push history returned ${res.status}`);
      const data = await res.json() as { history?: Array<{ id: string; sentAt: string; readAt: string | null; passage: Passage }> };
      const unread = (data.history ?? []).filter((item) => !item.readAt);
      setUnreadPush({
        count: unread.length,
        latest: unread[0] ? { id: unread[0].id, sentAt: unread[0].sentAt, passage: unread[0].passage } : null,
      });
    } catch (e) {
      console.error(e);
      setUnreadPush({ count: 0, latest: null });
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const isAuth = await logtoClient.isAuthenticated();
      if (!isAuth) {
        setStats(null);
        return;
      }
      const res = await apiFetch('/reading/stats');
      if (!res.ok) throw new Error(`Reading stats returned ${res.status}`);
      const data = await res.json();
      setStats({ todayCount: data.todayCount ?? 0, streakDays: data.streakDays ?? 0 });
    } catch (e) {
      console.error(e);
      setStats(null);
    }
  }, []);

  const fetchPassage = useCallback(async (preferUnread = false, skippedPassageId?: string) => {
    setLoading(true);
    setBookmarked(false);
    setQueued(false);
    setWhyPersonalized(null);
    setLoadError(null);
    try {
      const isAuth = await logtoClient.isAuthenticated();
      setAuthed(isAuth);
      const params = new URLSearchParams();
      if (preferUnread && isAuth) params.set('preferUnread', '1');
      if (skippedPassageId && isAuth) params.set('skipPassageId', skippedPassageId);
      const activeTag = selectedTagRef.current;
      if (activeTag) params.set('tag', activeTag);
      const query = params.toString() ? `?${params.toString()}` : '';

      let res: Response;
      try {
        res = isAuth
          ? await apiFetch(`/passages/random${query}`)
          : await fetch(`/api/passages/random${query}`);
      } catch (authError) {
        if (!isAuth) throw authError;
        console.error(authError);
        setLoadError('Session refresh failed — showing the public feed. Sign in again if you want personalized passages.');
        res = await fetch('/api/passages/random');
      }

      if (!res.ok) {
        const message = passageErrorMessage(res.status);
        if (!isAuth || (res.status !== 401 && res.status !== 403 && res.status < 500)) {
          throw new Error(message);
        }
        console.warn(message);
        setLoadError(message);
        res = await fetch('/api/passages/random');
        if (!res.ok) throw new Error(`Public passage fallback returned ${res.status}`);
      }

      const data = await res.json();
      setPassage(data.passage ?? null);
      setQueued(data.passage?.id ? isPassageQueued(data.passage.id) : false);
      setWhyPersonalized(data.whyPersonalized ?? null);
      if (isAuth) {
        void fetchStats();
        void fetchDailyQueue();
        void fetchReadingPath();
        void fetchDailyReview();
        void fetchUnreadPush();
        void fetchReadingChallenges();
      }
    } catch (e) {
      console.error(e);
      setPassage(null);
      setLoadError(isOfflineError(e)
        ? 'You are offline. Fresh Discover recommendations need the network; saved passages and push inbox can be read from cached Bookmarks/History after a prior online sync.'
        : e instanceof Error ? e.message : 'Could not load passage. Try again.');
    } finally {
      setLoading(false);
    }
  }, [fetchDailyQueue, fetchDailyReview, fetchReadingChallenges, fetchReadingPath, fetchStats, fetchUnreadPush]);

  const fetchPassageById = useCallback(async (passageId: string, source?: string | null) => {
    setLoading(true);
    setBookmarked(false);
    setQueued(false);
    setWhyPersonalized(null);
    setLoadError(null);
    try {
      const isAuth = await logtoClient.isAuthenticated();
      setAuthed(isAuth);
      const params = new URLSearchParams();
      if (source) params.set('source', source);
      const query = params.toString() ? `?${params.toString()}` : '';
      const res = isAuth
        ? await apiFetch(`/passages/${encodeURIComponent(passageId)}${query}`)
        : await fetch(`/api/passages/${encodeURIComponent(passageId)}${query}`);
      if (!res.ok) throw new Error(`Passage ${passageId} returned ${res.status}`);
      const data = await res.json();
      setPassage(data.passage);
      setQueued(data.passage?.id ? isPassageQueued(data.passage.id) : false);
      setWhyPersonalized(data.whyPersonalized ?? null);
      if (isAuth) {
        void fetchStats();
        void fetchDailyQueue();
        void fetchReadingPath();
        void fetchDailyReview();
        void fetchUnreadPush();
        void fetchReadingChallenges();
      }
    } catch (e) {
      console.error(e);
      if (isOfflineError(e)) {
        setPassage(null);
        setLoadError('You are offline. Reconnect to open and mark this pushed passage read, or use History to read cached push-inbox cards from your last online session.');
      } else {
        setLoadError('Could not load the pushed passage. Showing another passage instead.');
        await fetchPassage(true);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchDailyQueue, fetchDailyReview, fetchPassage, fetchReadingChallenges, fetchReadingPath, fetchStats, fetchUnreadPush]);

  useEffect(() => {
    void fetchTopTags();
  }, [fetchTopTags]);

  useEffect(() => {
    if (pushPassageId) {
      void fetchPassageById(pushPassageId, pushSource);
      return;
    }
    void fetchPassage(false);
  }, [fetchPassage, fetchPassageById, fetchTopTags, pushPassageId, pushSource]);

  const handleReviewAction = async (item: DailyReviewItem, action: 'reviewed' | 'skip') => {
    try {
      const res = await apiFetch(`/daily-review/${encodeURIComponent(item.bookmarkId)}`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      const schedule = await res.json() as ReviewSchedulePayload;
      setReviewStatus(formatReviewScheduleFeedback(action, schedule));
      setDailyReview((current) => current
        ? { ...current, items: current.items.filter((candidate) => candidate.bookmarkId !== item.bookmarkId) }
        : current);
      void fetchReadingChallenges();
      window.setTimeout(() => setReviewStatus(null), 2500);
    } catch (e) {
      console.error(e);
      setReviewStatus('Could not update review. Try again.');
    }
  };

  const handleBookmark = async () => {
    if (!passage || !authed) return;
    try {
      await apiFetch('/bookmarks', {
        method: 'POST',
        body: JSON.stringify({ passageId: passage.id }),
      });
      setBookmarked(true);
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddToQueue = () => {
    if (!passage) return;
    addPassageToReadingQueue(passage);
    setQueued(true);
  };

  const stopDailyQueue = useCallback(() => {
    if (speechQueueAvailable()) window.speechSynthesis.cancel();
    dailyQueueUtteranceRef.current = null;
    setQueuePlayback('idle');
    setQueueActiveIndex(null);
  }, []);

  const speakDailyQueueItem = useCallback((index: number) => {
    const queue = dailyQueue?.queue ?? [];
    const item = queue[index];
    if (!item) {
      stopDailyQueue();
      return;
    }

    if (!speechQueueAvailable()) {
      setQueueNotice('Daily listening is not available in this browser. You can still open and read each fresh page.');
      setQueuePlayback('idle');
      return;
    }

    dailyQueueUtteranceRef.current = null;
    window.speechSynthesis.cancel();
    setQueueActiveIndex(index);
    setQueuePlayback('playing');
    setQueueNotice(null);
    void fetchPassageById(item.id, 'discover');

    const textToRead = `${item.bookTitle}. ${item.author}. ${item.text}`.replace(/\s+/g, ' ').trim();
    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.rate = 0.92;
    utterance.pitch = 1;
    utterance.lang = /[\u3400-\u9fff]/.test(textToRead) ? 'zh-CN' : 'en-US';
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find((voice) => voice.lang?.toLowerCase().startsWith(utterance.lang.toLowerCase().slice(0, 2)));
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onend = () => {
      if (dailyQueueUtteranceRef.current !== utterance) return;
      dailyQueueUtteranceRef.current = null;
      const nextIndex = index + 1;
      if (nextIndex < queue.length) {
        window.setTimeout(() => speakDailyQueueItem(nextIndex), 250);
      } else {
        setQueuePlayback('idle');
        setQueueActiveIndex(null);
        setQueueNotice('Daily listening queue complete.');
      }
    };
    utterance.onerror = () => {
      if (dailyQueueUtteranceRef.current !== utterance) return;
      dailyQueueUtteranceRef.current = null;
      setQueuePlayback('idle');
      setQueueNotice('Could not play this daily queue on this device. Reading mode is still available.');
    };

    dailyQueueUtteranceRef.current = utterance;
    if (voices.length === 0) setQueueNotice('Using your browser default voice. If you hear nothing, this device may not have a speech voice installed.');
    window.speechSynthesis.speak(utterance);
  }, [dailyQueue?.queue, fetchPassageById, stopDailyQueue]);

  const startDailyQueue = useCallback(() => {
    if (!dailyQueue?.queue.length) return;
    speakDailyQueueItem(queueActiveIndex ?? 0);
  }, [dailyQueue?.queue.length, queueActiveIndex, speakDailyQueueItem]);

  const pauseDailyQueue = useCallback(() => {
    if (!speechQueueAvailable()) return;
    window.speechSynthesis.pause();
    setQueuePlayback('paused');
  }, []);

  const resumeDailyQueue = useCallback(() => {
    if (!speechQueueAvailable()) return;
    window.speechSynthesis.resume();
    setQueuePlayback('playing');
  }, []);

  const nextDailyQueue = useCallback(() => {
    const queue = dailyQueue?.queue ?? [];
    const nextIndex = Math.min((queueActiveIndex ?? -1) + 1, queue.length - 1);
    if (nextIndex >= 0) speakDailyQueueItem(nextIndex);
  }, [dailyQueue?.queue, queueActiveIndex, speakDailyQueueItem]);

  const tags = parsePassageTags(passage?.tags);
  const accent = passageAccent(tags);

  return (
    <div className="min-h-screen overflow-hidden bg-base-100 text-base-content">
      <div className={`absolute inset-x-0 top-0 h-80 bg-gradient-to-br ${accent} opacity-80 blur-3xl`} />
      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-4 sm:px-6">
        <nav className="navbar mb-3 rounded-[2rem] border border-white/10 bg-base-200/70 shadow-2xl backdrop-blur md:mb-5">
          <div className="flex-1">
            <span className="font-serif text-lg tracking-wide sm:text-xl">📖 RandomPage</span>
          </div>
          <div className="flex-none gap-1 sm:gap-2">
            <Link to="/bookmarks" className="btn btn-ghost btn-xs sm:btn-sm">Shelf</Link>
            <Link to="/history" className="btn btn-ghost btn-xs sm:btn-sm">History</Link>
            <Link to="/settings" className="btn btn-ghost btn-xs sm:btn-sm">Settings</Link>
          </div>
        </nav>

        {/* Tag filter chip-strip */}
        {topTags.length > 0 && (
          <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
            <button
              className={`btn btn-sm shrink-0 rounded-full ${
                selectedTag === null ? 'btn-primary' : 'btn-outline border-white/20 bg-base-200/60'
              }`}
              onClick={() => { setSelectedTag(null); void fetchPassage(false, passage?.id ?? undefined); }}
            >
              All
            </button>
            {topTags.map((tag) => (
              <button
                key={tag}
                className={`btn btn-sm shrink-0 rounded-full capitalize ${
                  selectedTag === tag ? 'btn-primary' : 'btn-outline border-white/20 bg-base-200/60'
                }`}
                style={{ minHeight: '44px' }}
                onClick={() => {
                  const next = selectedTag === tag ? null : tag;
                  setSelectedTag(next);
                  void fetchPassage(false, passage?.id ?? undefined);
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {(!online || loadError?.includes('offline')) && (
          <div className="alert alert-info mb-4 shadow-xl">
            <span>Offline mode — fresh recommendations need network. Cached saved and pushed passages are available from Bookmarks and History after an online sync.</span>
          </div>
        )}

        <main className="grid flex-1 items-center gap-5 lg:grid-cols-[0.85fr_1.15fr]">
          <section className="space-y-4 lg:pb-20">
            <p className="text-xs uppercase tracking-[0.35em] text-primary/80">Daily discovery</p>
            <div>
              <h1 className="font-serif text-4xl leading-tight sm:text-5xl">One page worth keeping.</h1>
              <p className="mt-3 max-w-md text-sm leading-relaxed opacity-70 sm:text-base">
                A personal reading ritual: short literary fragments, weighted by what you read, save, and skip.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {authed ? (
                <>
                  <div className="rounded-3xl border border-white/10 bg-base-200/70 p-4 shadow-xl backdrop-blur">
                    <div className="text-3xl font-semibold">{stats?.todayCount ?? '—'}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.2em] opacity-60">read today</div>
                  </div>
                  <div className="rounded-3xl border border-white/10 bg-base-200/70 p-4 shadow-xl backdrop-blur">
                    <div className="text-3xl font-semibold">{stats?.streakDays ?? '—'}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.2em] opacity-60">day streak</div>
                  </div>
                </>
              ) : (
                <div className="col-span-2 rounded-3xl border border-primary/20 bg-primary/10 p-4 shadow-xl backdrop-blur">
                  <div className="font-semibold">Build your reading streak</div>
                  <p className="mt-1 text-sm opacity-70">Sign in to track passages read today and your daily habit loop.</p>
                  <Link to="/signin" className="btn btn-primary btn-sm mt-3">Sign in</Link>
                </div>
              )}
            </div>


            {authed && readingChallenges?.challenges.length ? (
              <div className="rounded-[2rem] border border-warning/30 bg-warning/10 p-4 shadow-xl backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-warning">Reading challenges</p>
                    <p className="mt-1 text-sm opacity-70">Lightweight badges from your existing reading, review, path, and push history.</p>
                  </div>
                  <span className="badge badge-warning badge-outline shrink-0">
                    {readingChallenges.summary.complete}/{readingChallenges.summary.total} earned
                  </span>
                </div>
                <div className="mt-3 grid gap-2">
                  {readingChallenges.challenges.slice(0, 5).map((challenge) => (
                    <Link
                      key={challenge.id}
                      to={challenge.href ?? '/discover'}
                      className="rounded-2xl border border-white/10 bg-base-100/45 p-3 transition hover:border-warning/50 hover:bg-warning/10"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`badge badge-sm ${challenge.complete ? 'badge-success' : 'badge-warning badge-outline'}`}>
                              {challenge.complete ? '✓ earned' : `${challenge.count}/${challenge.target}`}
                            </span>
                            <span className="line-clamp-1 text-sm font-semibold">{challenge.label}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs opacity-70">{challenge.description}</p>
                          {challenge.count === 0 && <p className="mt-1 text-xs opacity-55">{challenge.emptyHint}</p>}
                        </div>
                        <span className="text-xs font-semibold opacity-70">{challenge.percent}%</span>
                      </div>
                      <progress className="progress progress-warning mt-3 h-2" value={challenge.percent} max="100" aria-label={`${challenge.label} progress`} />
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}


            {authed && unreadPush.count > 0 && unreadPush.latest && (
              <Link
                to="/history?tab=push"
                className="block rounded-[2rem] border border-primary/40 bg-primary/15 p-4 shadow-xl backdrop-blur transition hover:border-primary hover:bg-primary/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-primary">Unread push inbox</p>
                    <p className="mt-2 text-sm font-semibold">{unreadPush.count} pushed passage{unreadPush.count === 1 ? '' : 's'} waiting</p>
                    <p className="mt-1 line-clamp-2 text-sm opacity-70">Latest: {unreadPush.latest.passage.bookTitle} — {unreadPush.latest.passage.author}</p>
                  </div>
                  <span className="badge badge-primary shrink-0">Open inbox</span>
                </div>
              </Link>
            )}

            {authed && dailyReview?.items.length ? (
              <div className="rounded-[2rem] border border-secondary/30 bg-secondary/10 p-4 shadow-xl backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-secondary">Daily Review</p>
                    <p className="mt-1 text-sm opacity-70">Revisit passages you already saved.</p>
                  </div>
                  <span className="badge badge-secondary badge-outline">{dailyReview.items.length} due</span>
                </div>
                {reviewStatus && <div className="alert alert-info mt-3 py-2 text-sm"><span>{reviewStatus}</span></div>}
                <div className="mt-3 space-y-2">
                  {dailyReview.items.map((item) => (
                    <div key={item.bookmarkId} className="rounded-2xl border border-white/10 bg-base-100/45 p-3">
                      <button
                        className="w-full text-left"
                        onClick={() => fetchPassageById(item.passageId, 'discover')}
                      >
                        <div className="flex items-center gap-2">
                          <span className="badge badge-sm badge-secondary">{item.reviewPosition}</span>
                          <span className="line-clamp-1 text-sm font-semibold">{item.passage.bookTitle}</span>
                        </div>
                        {item.note && (
                          <div className="mt-2 rounded-xl border border-warning/20 bg-warning/10 p-2 text-xs">
                            <p className="font-semibold uppercase tracking-[0.16em] opacity-60">Your private note</p>
                            <p className="mt-1 line-clamp-2 opacity-80">{item.note}</p>
                          </div>
                        )}
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed opacity-70">{shortExcerpt(item.passage.text)}</p>
                        <p className="mt-1 text-xs opacity-50">{item.passage.author}</p>
                      </button>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <SharePassageButton passage={item.passage} compact />
                        <SharePassageImageButton passage={item.passage} compact />
                        <div className="grid flex-1 grid-cols-2 gap-2">
                          <button className="btn btn-secondary btn-sm rounded-xl" onClick={() => handleReviewAction(item, 'reviewed')}>Reviewed</button>
                          <button className="btn btn-ghost btn-sm rounded-xl" onClick={() => handleReviewAction(item, 'skip')}>Skip today</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {authed && (
              <div className="rounded-[2rem] border border-accent/30 bg-accent/10 p-4 shadow-xl backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-accent">7-day reading path</p>
                    <p className="mt-1 text-sm opacity-70">A goal-based sequence of existing book passages — no summaries, no courses.</p>
                  </div>
                  {readingPath ? <span className="badge badge-accent badge-outline">Day {readingPath.currentDay}/{readingPath.totalDays}</span> : null}
                </div>
                {readingPath?.current ? (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-base-100/50 p-3">
                    <button className="w-full text-left" onClick={() => fetchPassageById(readingPath.current!.passage.id, 'discover')}>
                      <div className="flex items-center gap-2">
                        <span className="badge badge-accent">Day {readingPath.current.day}/7</span>
                        <span className="line-clamp-1 text-sm font-semibold">{readingPath.current.passage.bookTitle}</span>
                      </div>
                      <p className="mt-1 text-xs opacity-60">{readingPath.current.passage.author} · {readingPath.topic}</p>
                      <p className="mt-2 line-clamp-2 text-sm leading-relaxed opacity-75">{shortExcerpt(readingPath.current.passage.text)}</p>
                      <p className="mt-2 text-xs text-accent/80">{readingPath.current.reason}</p>
                    </button>
                    {readingPath.upcoming.length > 0 && (
                      <div className="mt-3 grid gap-2">
                        {readingPath.upcoming.slice(0, 6).map((item) => (
                          <div key={`${readingPath.id}-${item.day}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-base-200/40 px-3 py-2">
                            <span className="badge badge-sm badge-outline">Day {item.day}/7</span>
                            <span className="min-w-0 flex-1 line-clamp-1 text-xs opacity-75">{item.passage.bookTitle} · {item.passage.author}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 grid gap-2">
                    {(readingPathGoals.length ? readingPathGoals : [
                      { id: 'reflective-philosophy', label: 'Reflective philosophy', tags: ['philosophy', 'morality'] },
                      { id: 'inner-life-psychology', label: 'Inner life & psychology', tags: ['psychology', 'relationships'] },
                      { id: 'history-society', label: 'History & society', tags: ['history', 'power'] },
                    ]).slice(0, 3).map((goal) => (
                      <button
                        key={goal.id}
                        type="button"
                        className="btn btn-outline h-auto min-h-0 justify-start rounded-2xl border-accent/30 py-3 text-left"
                        onClick={() => startReadingPath(goal.id)}
                        disabled={pathLoading}
                      >
                        <span>
                          <span className="block font-semibold">Start {goal.label}</span>
                          <span className="block text-xs opacity-70">7 days · {goal.tags.slice(0, 3).join(' · ')}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {pathStatus ? <p className="mt-2 text-xs opacity-70">{pathStatus}</p> : null}
              </div>
            )}

            {authed && (
              <div className="rounded-[2rem] border border-primary/15 bg-base-200/70 p-4 shadow-xl backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-primary/80">Today&apos;s fresh pages</p>
                    <p className="mt-1 text-sm opacity-70">3–5 personalized unread picks, refreshed daily.</p>
                    {dailyQueue?.fallbackUsed ? (
                      <p className="mt-1 text-xs text-primary/80">Fresh unread pool is low, so today includes personalized pages you have not seen recently.</p>
                    ) : null}
                  </div>
                  <span className="badge badge-primary badge-outline">{dailyQueue?.queue.length ?? 0}/5</span>
                </div>
                {dailyQueue?.queue.length ? (
                  <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/10 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {queuePlayback === 'playing' ? (
                        <button type="button" className="btn btn-secondary btn-sm rounded-xl" onClick={pauseDailyQueue}>⏸ Pause queue</button>
                      ) : queuePlayback === 'paused' ? (
                        <button type="button" className="btn btn-secondary btn-sm rounded-xl" onClick={resumeDailyQueue}>▶ Resume queue</button>
                      ) : (
                        <button type="button" className="btn btn-primary btn-sm rounded-xl" onClick={startDailyQueue}>🔊 Start daily listening</button>
                      )}
                      {queuePlayback !== 'idle' && (
                        <>
                          <button type="button" className="btn btn-outline btn-sm rounded-xl" onClick={nextDailyQueue} disabled={(queueActiveIndex ?? 0) >= dailyQueue.queue.length - 1}>Next</button>
                          <button type="button" className="btn btn-ghost btn-sm rounded-xl" onClick={stopDailyQueue}>Stop</button>
                        </>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed opacity-70">
                      Plays today&apos;s personalized book passages in sequence using your browser voice. Each active passage opens here so the listen counts as your own Discover interaction.
                    </p>
                    {queueActiveIndex !== null && dailyQueue.queue[queueActiveIndex] && (
                      <p className="mt-2 text-xs text-primary/80" role="status">
                        Now playing {queueActiveIndex + 1}/{dailyQueue.queue.length}: {dailyQueue.queue[queueActiveIndex].bookTitle} — {dailyQueue.queue[queueActiveIndex].author}
                      </p>
                    )}
                    {queueNotice && <p className="mt-2 text-xs opacity-60" role="status">{queueNotice}</p>}
                  </div>
                ) : null}
                <div className="mt-3 space-y-2">
                  {dailyQueue?.queue.length ? dailyQueue.queue.map((item) => (
                    <button
                      key={item.id}
                      className={`w-full rounded-2xl border px-3 py-2 text-left transition hover:border-primary/50 hover:bg-primary/10 ${passage?.id === item.id || dailyQueue.queue[queueActiveIndex ?? -1]?.id === item.id ? 'border-primary/60 bg-primary/15' : 'border-white/10 bg-base-100/40'}`}
                      onClick={() => fetchPassageById(item.id, 'discover')}
                    >
                      <div className="flex items-center gap-2">
                        <span className="badge badge-sm">{item.queuePosition}</span>
                        <span className="line-clamp-1 text-sm font-medium">{item.bookTitle}</span>
                      </div>
                      <div className="mt-1 line-clamp-1 text-xs opacity-60">{item.author} · {Math.max(1, Math.round(item.text.length / 220))} min</div>
                      {item.whyPersonalized && (
                        <div className="mt-1 line-clamp-1 text-xs text-primary/80">{item.whyPersonalized.label}: {item.whyPersonalized.matchedTags.slice(0, 2).join(' + ')}</div>
                      )}
                    </button>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-white/10 p-3 text-sm opacity-70">
                      <p>{dailyQueue?.emptyReason ?? 'No daily pages are available yet.'}</p>
                      <button type="button" className="btn btn-outline btn-xs mt-3 rounded-xl" onClick={fetchDailyQueue}>Refresh queue</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="mx-auto w-full max-w-2xl">
            {loading ? (
              <div className="card min-h-[28rem] border border-white/10 bg-base-200/80 shadow-2xl backdrop-blur">
                <div className="card-body items-center justify-center text-center">
                  <span className="loading loading-spinner loading-lg" />
                  <p className="opacity-60">Finding a passage for you…</p>
                </div>
              </div>
            ) : passage ? (
              <div className="space-y-3">
                {loadError && (
                  <div className="alert alert-warning text-sm">
                    <span>{loadError}</span>
                    <button className="btn btn-ghost btn-xs" onClick={() => fetchPassage(true)}>Retry</button>
                  </div>
                )}
                <article className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-base-200/90 shadow-2xl backdrop-blur">
                <div className={`absolute inset-x-0 top-0 h-28 bg-gradient-to-r ${accent} opacity-60`} />
                <div className="relative p-5 sm:p-7">
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-primary/80">Today's card</p>
                      <BookSourceLink
                        bookTitle={passage.bookTitle}
                        author={passage.author}
                        chapter={passage.chapter}
                        className="mt-2 text-2xl leading-tight sm:text-3xl"
                      />
                    </div>
                    <div className="rounded-full border border-white/10 bg-base-100/60 px-3 py-1 text-xs opacity-80">
                      {Math.max(1, Math.round(passage.text.length / 220))} min
                    </div>
                  </div>

                  <blockquote className="relative rounded-[1.5rem] border border-white/10 bg-base-100/55 p-5 font-serif text-lg leading-8 shadow-inner sm:p-6 sm:text-xl sm:leading-9">
                    <span className="absolute -left-1 -top-6 font-serif text-7xl text-primary/25">“</span>
                    <span className="relative">{passage.text}</span>
                  </blockquote>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {tags.slice(0, 5).map(tag => (
                      <span key={tag} className="badge badge-outline border-primary/30 bg-base-100/40 text-xs">{tag}</span>
                    ))}
                  </div>

                  {authed && whyPersonalized && (
                    <div className="mt-4 rounded-2xl border border-primary/25 bg-primary/10 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="badge badge-primary badge-outline">{whyPersonalized.label}</span>
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/80">Why this page?</span>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed opacity-80">{whyPersonalized.reason}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {whyPersonalized.matchedTags.slice(0, 3).map(tag => (
                          <span key={tag} className="badge badge-ghost badge-xs">#{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <PassageFeedbackChips
                    passageId={passage.id}
                    source={pushSource === 'push' || pushSource === 'push_inbox' ? 'push_inbox' : 'discover'}
                    authed={authed}
                    disabled={!online}
                    className="mt-4"
                    onFeedback={() => {
                      void fetchDailyQueue();
                      void fetchReadingChallenges();
                    }}
                  />

                  <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto_auto]">
                    <button
                      className="btn btn-primary btn-lg rounded-2xl"
                      onClick={() => fetchPassage(false, passage.id)}
                    >
                      Next passage →
                    </button>
                    <ListenControl text={passage.text} title={`${passage.bookTitle} passage`} />
                    <SharePassageButton passage={passage} />
                    <SharePassageImageButton passage={passage} />
                    <button
                      type="button"
                      className={`btn rounded-2xl ${queued ? 'btn-accent' : 'btn-outline'}`}
                      onClick={handleAddToQueue}
                      disabled={queued}
                    >
                      {queued ? '✓ Queued' : 'Add to queue'}
                    </button>
                    {authed ? (
                      <button
                        className={`btn rounded-2xl ${bookmarked ? 'btn-success' : 'btn-ghost'}`}
                        onClick={handleBookmark}
                        disabled={bookmarked}
                      >
                        {bookmarked ? '✓ Saved' : 'Bookmark'}
                      </button>
                    ) : (
                      <Link to="/signin" className="btn btn-ghost rounded-2xl opacity-70">
                        Sign in to save
                      </Link>
                    )}
                  </div>
                </div>
                </article>
              </div>
            ) : loadError ? (
              <div className="alert alert-error flex-col items-start gap-3 sm:flex-row sm:items-center">
                <span>{loadError}</span>
                <button className="btn btn-sm" disabled={!online} onClick={() => fetchPassage(true)}>Retry</button>
                <Link to="/history" className="btn btn-ghost btn-sm">Cached history</Link>
              </div>
            ) : (
              <div className="alert alert-warning">No passages found.</div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
