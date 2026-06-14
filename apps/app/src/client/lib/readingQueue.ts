export interface QueuePassage {
  id: string;
  text: string;
  bookTitle: string;
  author: string;
  chapter?: string;
  tags: string;
  language?: string;
}

export interface QueuedPassage {
  id: string;
  addedAt: string;
  passage: QueuePassage;
}

const QUEUE_STORAGE_KEY = 'randompage_my_reading_queue_v1';

function normalizePassage(passage: QueuePassage): QueuePassage {
  return {
    id: String(passage.id),
    text: passage.text ?? '',
    bookTitle: passage.bookTitle ?? 'Untitled passage',
    author: passage.author ?? 'Unknown author',
    chapter: passage.chapter,
    tags: passage.tags ?? '[]',
    language: passage.language,
  };
}

export function readReadingQueue(): QueuedPassage[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QUEUE_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item?.passage?.id)
      .map(item => ({
        id: String(item.id ?? item.passage.id),
        addedAt: typeof item.addedAt === 'string' ? item.addedAt : new Date().toISOString(),
        passage: normalizePassage(item.passage),
      }));
  } catch {
    return [];
  }
}

function writeReadingQueue(queue: QueuedPassage[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

export function isPassageQueued(passageId: string) {
  return readReadingQueue().some(item => item.passage.id === passageId);
}

export function addPassageToReadingQueue(passage: QueuePassage) {
  const normalized = normalizePassage(passage);
  const current = readReadingQueue().filter(item => item.passage.id !== normalized.id);
  const next = [
    ...current,
    { id: normalized.id, addedAt: new Date().toISOString(), passage: normalized },
  ];
  writeReadingQueue(next);
  return next;
}

export function removePassageFromReadingQueue(passageId: string) {
  const next = readReadingQueue().filter(item => item.passage.id !== passageId);
  writeReadingQueue(next);
  return next;
}

export function clearReadingQueue() {
  writeReadingQueue([]);
  return [];
}
