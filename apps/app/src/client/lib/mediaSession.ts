type MediaSessionActionName = 'play' | 'pause' | 'stop' | 'previoustrack' | 'nexttrack';

type MediaSessionHandlers = Partial<Record<MediaSessionActionName, () => void>>;

const RANDOMPAGE_ARTWORK = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
];

export function mediaSessionAvailable() {
  return typeof navigator !== 'undefined'
    && 'mediaSession' in navigator
    && typeof window !== 'undefined'
    && 'MediaMetadata' in window;
}

export function setPassageMediaSession({
  title,
  artist,
  album = 'RandomPage',
  handlers = {},
}: {
  title: string;
  artist?: string;
  album?: string;
  handlers?: MediaSessionHandlers;
}) {
  if (!mediaSessionAvailable()) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: title || 'RandomPage passage',
    artist: artist || 'RandomPage',
    album,
    artwork: RANDOMPAGE_ARTWORK,
  });

  for (const action of ['play', 'pause', 'stop', 'previoustrack', 'nexttrack'] as MediaSessionActionName[]) {
    try {
      navigator.mediaSession.setActionHandler(action, handlers[action] ?? null);
    } catch {
      // Some browsers expose Media Session metadata but do not support every action.
    }
  }
}

export function clearPassageMediaSession() {
  if (!mediaSessionAvailable()) return;

  navigator.mediaSession.metadata = null;
  try {
    navigator.mediaSession.playbackState = 'none';
  } catch {
    // playbackState is best-effort.
  }
  for (const action of ['play', 'pause', 'stop', 'previoustrack', 'nexttrack'] as MediaSessionActionName[]) {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      // Unsupported action, nothing to clear.
    }
  }
}

export function setMediaSessionPlaybackState(state: MediaSessionPlaybackState) {
  if (!mediaSessionAvailable()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    // playbackState is best-effort.
  }
}
