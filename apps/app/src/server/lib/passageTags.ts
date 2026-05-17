export function parsePassageTags(raw: string | null | undefined): string[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(tag => String(tag).trim()).filter(Boolean);
    }
  } catch {
    // Fall back to legacy comma-delimited tags below.
  }

  return text.split(',').map(tag => tag.trim()).filter(Boolean);
}

export function scorePassageTags(rawTags: string | null | undefined, preferences: Record<string, number>): number {
  const tags = parsePassageTags(rawTags);
  const score = tags.reduce((sum, tag) => sum + (preferences[tag] || 1), 0);
  return score > 0 ? score : 1;
}
