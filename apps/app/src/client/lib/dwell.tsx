import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import { logtoClient } from './logto';

const MIN_DWELL_EVENT_MS = 3000;
const MAX_DWELL_EVENT_MS = 10 * 60 * 1000;

type DwellSource = 'discover' | 'push_inbox';

async function sendDwell(passageId: string, source: DwellSource, dwellMs: number) {
  const bounded = Math.min(MAX_DWELL_EVENT_MS, Math.max(0, Math.round(dwellMs)));
  if (bounded < MIN_DWELL_EVENT_MS) return;
  try {
    if (!(await logtoClient.isAuthenticated())) return;
    await apiFetch(`/passages/${encodeURIComponent(passageId)}/dwell`, {
      method: 'POST',
      keepalive: true,
      body: JSON.stringify({ source, dwellMs: bounded }),
    });
  } catch (error) {
    console.warn('Could not record passage dwell', error);
  }
}

export function usePassageDwell(passageId: string | null | undefined, source: DwellSource, active = true) {
  const startedAtRef = useRef<number | null>(null);
  const sentKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!passageId || !active) return undefined;
    const key = `${passageId}:${source}`;
    startedAtRef.current = Date.now();
    sentKeyRef.current = null;

    const flush = () => {
      if (!startedAtRef.current || sentKeyRef.current === key) return;
      const dwellMs = Date.now() - startedAtRef.current;
      sentKeyRef.current = key;
      void sendDwell(passageId, source, dwellMs);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [active, passageId, source]);
}

export function PassageDwellTracker({ passageId, source, active = true }: { passageId: string; source: DwellSource; active?: boolean }) {
  usePassageDwell(passageId, source, active);
  return null;
}

export function VisiblePassageDwellTracker({ passageId, source }: { passageId: string; source: DwellSource }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.6)),
      { threshold: [0, 0.6, 1] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  usePassageDwell(passageId, source, visible);
  return <span ref={ref} aria-hidden="true" className="sr-only" />;
}
