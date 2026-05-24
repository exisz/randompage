export const MIN_PASSAGE_CHARS = 180;
export const TARGET_PASSAGE_CHARS = 300;
export const MAX_PASSAGE_CHARS = 800;

export type PassageLike = { text: string };

export function isReadablePassageLength(passage: PassageLike | null | undefined) {
  const len = passage?.text?.length ?? 0;
  return len >= MIN_PASSAGE_CHARS && len <= MAX_PASSAGE_CHARS;
}

export function filterReadablePassages<T extends PassageLike>(passages: T[]) {
  return passages.filter(isReadablePassageLength);
}
