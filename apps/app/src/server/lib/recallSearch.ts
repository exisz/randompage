export interface RecallSearchPassageInput {
  id: string;
  text: string;
  bookTitle: string;
  author: string;
  chapter?: string | null;
  tags?: string | null;
  note?: string | null;
  collections?: string[];
  sources?: string[];
}

export interface RecallSearchResult extends RecallSearchPassageInput {
  score: number;
  matchReason: string;
  snippet: string;
  matchedFields: string[];
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'with', 'about', 'into', 'when', 'where', 'why', 'your', 'their', 'they', 'them', 'his', 'her', 'our', 'you', 'not', 'but', 'than', 'then',
]);

export function parseRecallTags(tags: string | null | undefined) {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return tags.split(',').map(tag => tag.trim()).filter(Boolean);
  }
}

export function tokenizeRecallQuery(query: string) {
  const normalized = query
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  return Array.from(new Set(
    normalized
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2 && !STOPWORDS.has(token))
  ));
}

function fieldScore(tokens: string[], value: string, weight: number) {
  const lower = value.toLowerCase();
  let score = 0;
  const matched: string[] = [];
  for (const token of tokens) {
    if (lower.includes(token)) {
      score += weight;
      matched.push(token);
      continue;
    }
    const partial = lower.split(/[^a-z0-9\u4e00-\u9fff]+/).some(word => word.length >= 5 && (word.includes(token) || token.includes(word)));
    if (partial) {
      score += weight * 0.45;
      matched.push(token);
    }
  }
  return { score, matched };
}

function makeSnippet(text: string, tokens: string[]) {
  const lower = text.toLowerCase();
  const firstHit = tokens
    .map(token => lower.indexOf(token))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (firstHit ?? 0) - 80);
  const end = Math.min(text.length, start + 220);
  const snippet = text.slice(start, end).trim();
  return `${start > 0 ? '…' : ''}${snippet}${end < text.length ? '…' : ''}`;
}

export function scoreRecallPassages(query: string, passages: RecallSearchPassageInput[], limit = 8): RecallSearchResult[] {
  const tokens = tokenizeRecallQuery(query);
  if (tokens.length === 0) return [];

  return passages
    .map((passage) => {
      const tags = parseRecallTags(passage.tags);
      const fields = [
        { name: 'private note', value: passage.note ?? '', weight: 8 },
        { name: 'title', value: passage.bookTitle, weight: 7 },
        { name: 'author', value: passage.author, weight: 4 },
        { name: 'tag', value: tags.join(' '), weight: 6 },
        { name: 'collection', value: (passage.collections ?? []).join(' '), weight: 5 },
        { name: 'passage text', value: passage.text, weight: 3 },
      ];
      let score = 0;
      const matchedFields: string[] = [];
      const matchedTokens = new Set<string>();
      for (const field of fields) {
        if (!field.value) continue;
        const result = fieldScore(tokens, field.value, field.weight);
        if (result.score > 0) {
          score += result.score;
          matchedFields.push(field.name);
          result.matched.forEach(token => matchedTokens.add(token));
        }
      }
      const coverage = matchedTokens.size / tokens.length;
      if (coverage >= 0.75) score *= 1.35;
      else if (coverage >= 0.5) score *= 1.15;
      if ((passage.sources ?? []).includes('bookmark')) score += 1.5;
      if (passage.note) score += 0.5;
      const strongest = matchedFields.slice(0, 3).join(', ');
      return {
        ...passage,
        score,
        matchedFields,
        matchReason: strongest ? `Matched ${strongest}` : 'No strong recall match',
        snippet: makeSnippet(passage.note && matchedFields.includes('private note') ? passage.note : passage.text, tokens),
      };
    })
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
