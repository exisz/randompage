import { useEffect, useState } from 'react';

const STORAGE_PREFIX = 'randompage:offline:';
const MAX_BOOKMARKS = 30;
const MAX_HISTORY = 30;

export interface OfflineBookmarksCache {
  bookmarks: unknown[];
  collections: unknown[];
  cachedAt: string;
}

export interface OfflineHistoryCache {
  browsingHistory: unknown[];
  pushHistory: unknown[];
  cachedAt: string;
}

function storageKey(name: string) {
  return `${STORAGE_PREFIX}${name}`;
}

function readJson<T>(name: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(name));
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(name: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(name), JSON.stringify(value));
  } catch {
    // localStorage can be unavailable or full; offline cache is best-effort.
  }
}

export function isOfflineError(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  return error instanceof TypeError && /fetch|network|load failed|failed to fetch/i.test(error.message);
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}

export function saveBookmarksOfflineCache(cache: Omit<OfflineBookmarksCache, 'cachedAt'>) {
  writeJson('bookmarks', {
    bookmarks: Array.isArray(cache.bookmarks) ? cache.bookmarks.slice(0, MAX_BOOKMARKS) : [],
    collections: Array.isArray(cache.collections) ? cache.collections : [],
    cachedAt: new Date().toISOString(),
  });
}

export function readBookmarksOfflineCache() {
  return readJson<OfflineBookmarksCache>('bookmarks');
}

export function saveHistoryOfflineCache(cache: Omit<OfflineHistoryCache, 'cachedAt'>) {
  writeJson('history', {
    browsingHistory: Array.isArray(cache.browsingHistory) ? cache.browsingHistory.slice(0, MAX_HISTORY) : [],
    pushHistory: Array.isArray(cache.pushHistory) ? cache.pushHistory.slice(0, MAX_HISTORY) : [],
    cachedAt: new Date().toISOString(),
  });
}

export function readHistoryOfflineCache() {
  return readJson<OfflineHistoryCache>('history');
}
