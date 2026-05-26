export type PassageTextLike = { text: string };

export type ReferenceNoteMatch = {
  reason: 'leading-return-marker' | 'standalone-note-heading' | 'reference-marker-cluster' | 'editorial-note-start';
};

const NOTE_HEADING_RE = /^(?:note|notes|footnote|footnotes|endnote|endnotes)\s*[:.\-—]/i;
const EDITORIAL_NOTE_START_RE = /^(?:\[[^\]]{1,80}\]|\([^)]{1,80}\))\s*(?:note|footnote|editor|translator|transcriber)/i;
const REFERENCE_MARKER_RE = /(?:↩|\[[0-9ivxlcdm]+\]|\([0-9ivxlcdm]+\)|\^[0-9]+|†|‡)/gi;

export function normalizePassageText(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function detectReferenceNoteFragment(text: string): ReferenceNoteMatch | null {
  const normalized = normalizePassageText(text);
  if (!normalized) return null;

  if (normalized.startsWith('↩')) return { reason: 'leading-return-marker' };
  if (NOTE_HEADING_RE.test(normalized)) return { reason: 'standalone-note-heading' };
  if (EDITORIAL_NOTE_START_RE.test(normalized)) return { reason: 'editorial-note-start' };

  const head = normalized.slice(0, 220);
  const markers = head.match(REFERENCE_MARKER_RE) ?? [];
  if (markers.length >= 3) return { reason: 'reference-marker-cluster' };

  return null;
}

export function isReadablePassageContent(passage: PassageTextLike | null | undefined) {
  return !detectReferenceNoteFragment(passage?.text ?? '');
}
