import { Router, type Request } from 'express';
import { nanoid } from 'nanoid';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';

export const importRouter = Router();

const allowedLicenses = new Set(['public-domain', 'cc0', 'cc-by', 'permission']);
const forbiddenPayloadFields = new Set(['text', 'content', 'html', 'chapters', 'epubBase64', 'base64', 'raw']);
const MIN_PASSAGE_CHARS = 180;
const TARGET_PASSAGE_CHARS = 300;
const MAX_PASSAGE_CHARS = 800;
const MAX_IMAGE_DATA_URL_CHARS = 6_000_000;

type TelegramEpubHandoff = {
  telegramFileId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  title?: unknown;
  author?: unknown;
  sourceUrl?: unknown;
  license?: unknown;
  publicDomain?: unknown;
  note?: unknown;
};

type OcrCandidateInput = {
  imageDataUrl?: unknown;
  title?: unknown;
  author?: unknown;
  source?: unknown;
  ocrText?: unknown;
  fixtureText?: unknown;
};

function handoffSecret() {
  return process.env.IMPORT_HANDOFF_SECRET || process.env.CRON_SECRET || '';
}

function isAuthorized(req: Request) {
  const secret = handoffSecret();
  if (!secret) return false;
  const bearer = req.header('authorization');
  const header = req.header('x-import-secret') || req.header('x-cron-secret');
  return bearer === `Bearer ${secret}` || header === secret;
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function containsForbiddenContent(body: Record<string, unknown>) {
  return Object.keys(body).some((key) => forbiddenPayloadFields.has(key));
}

function isEpubMime(mimeType: string | null, fileName: string | null) {
  return mimeType === 'application/epub+zip' || Boolean(fileName?.toLowerCase().endsWith('.epub'));
}

function epochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

function normalize(text: unknown) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function cleanOcrText(raw: unknown) {
  return String(raw || '')
    .replace(/\r/g, '')
    .replace(/\f/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => {
      if (!line) return true;
      if (/^\d+$/.test(line)) return false;
      if (/^[^A-Za-z]{1,12}$/.test(line)) return false;
      if (/^(contents|index|copyright|all rights reserved|isbn|printed in)\b/i.test(line)) return false;
      return line.length >= 3;
    })
    .join('\n')
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSentences(text: string) {
  return normalize(text).match(/[^.!?…。！？]+[.!?…。！？]["'”’）)\]》」』]*/g)?.map((s) => s.trim()).filter(Boolean) || [];
}

function isUsablePassage(text: string) {
  if (text.length < MIN_PASSAGE_CHARS || text.length > MAX_PASSAGE_CHARS) return false;
  if (!/[.!?…。！？]["'”’）)\]》」』]*$/.test(text)) return false;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  if (letters / Math.max(1, text.length) < 0.55) return false;
  if (/\b(?:copyright|all rights reserved|isbn|publisher|printed in)\b/i.test(text.slice(0, 260))) return false;
  return true;
}

function suggestTags(text: string) {
  const lower = text.toLowerCase();
  const tags = ['private', 'import-candidate', 'ocr-candidate', 'book-page'];
  const rules: Array<[string, RegExp]> = [
    ['philosophy', /\b(philosophy|wisdom|truth|virtue|soul|reason|stoic|mind)\b/],
    ['psychology', /\b(psychology|habit|memory|attention|emotion|desire|fear)\b/],
    ['history', /\b(history|empire|king|war|century|ancient|revolution)\b/],
    ['literature', /\b(novel|poem|story|character|voice|chapter)\b/],
    ['reflection', /\b(think|thought|question|meaning|learn|understand)\b/],
  ];
  for (const [tag, pattern] of rules) if (pattern.test(lower)) tags.push(tag);
  return [...new Set(tags)].slice(0, 8);
}

function buildCandidates(text: string, metadata: { title: string; author: string; source: string }, limit = 3) {
  const candidates: Array<{ index: number; text: string; charCount: number; title: string; author: string; source: string; tags: string[]; qualityNote: string }> = [];
  let buffer = '';
  for (const sentence of splitSentences(text)) {
    const next = buffer ? `${buffer} ${sentence}` : sentence;
    if (next.length <= MAX_PASSAGE_CHARS) {
      buffer = next;
      if (buffer.length >= TARGET_PASSAGE_CHARS) {
        maybeAddCandidate(candidates, buffer, metadata);
        buffer = '';
      }
    } else {
      maybeAddCandidate(candidates, buffer, metadata);
      buffer = sentence;
    }
    if (candidates.length >= limit) break;
  }
  if (candidates.length < limit) maybeAddCandidate(candidates, buffer, metadata);
  return candidates.slice(0, limit);
}

function maybeAddCandidate(candidates: ReturnType<typeof buildCandidates>, text: string, metadata: { title: string; author: string; source: string }) {
  const normalized = normalize(text);
  if (!isUsablePassage(normalized)) return;
  candidates.push({
    index: candidates.length + 1,
    text: normalized,
    charCount: normalized.length,
    title: metadata.title,
    author: metadata.author,
    source: metadata.source,
    tags: suggestTags(normalized),
    qualityNote: normalized.length >= TARGET_PASSAGE_CHARS ? 'Readable OCR candidate' : 'Short but reviewable OCR candidate',
  });
}

function validateImageDataUrl(value: unknown) {
  const dataUrl = asString(value);
  if (!dataUrl) return { ok: false, error: 'Select one page photo first.' };
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(dataUrl)) return { ok: false, error: 'Only one PNG, JPEG, or WebP page photo is accepted.' };
  if (dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) return { ok: false, error: 'Image is too large. Try a clearer cropped page under about 4MB.' };
  return { ok: true, dataUrl };
}

async function upsertReader(prisma: ReturnType<typeof getPrisma>, userId: string, now: Date) {
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO users (id, display_name, created_at)
    VALUES (${userId}, ${'Reader'}, ${epochSeconds(now)})
  `;
}

importRouter.post('/import/telegram-epub-handoff', (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = (req.body || {}) as TelegramEpubHandoff & Record<string, unknown>;
  if (containsForbiddenContent(body)) {
    res.status(400).json({
      error: 'Raw book text or encoded EPUB payloads are not accepted by the handoff API',
      policy: 'send Telegram file metadata only; fetch and parse must happen in a licensed worker path',
    });
    return;
  }

  const telegramFileId = asString(body.telegramFileId);
  const fileName = asString(body.fileName);
  const mimeType = asString(body.mimeType);
  const title = asString(body.title);
  const author = asString(body.author);
  const sourceUrl = asString(body.sourceUrl);
  const license = asString(body.license)?.toLowerCase() || null;
  const publicDomain = body.publicDomain === true;
  const allowedByLicense = publicDomain || Boolean(license && allowedLicenses.has(license));

  if (!telegramFileId) {
    res.status(400).json({ error: 'telegramFileId is required' });
    return;
  }
  if (!isEpubMime(mimeType, fileName)) {
    res.status(400).json({ error: 'Only EPUB handoff metadata is accepted', expected: 'application/epub+zip or .epub fileName' });
    return;
  }

  res.json({
    status: 'accepted',
    handoff: { telegramFileId, fileName, mimeType, title, author, sourceUrl, license, publicDomain },
    policy: {
      access_depth: allowedByLicense ? 'user-supplied-licensed-epub' : 'metadata-only',
      allowed_full_text_fetch: allowedByLicense,
      allowed_fields_to_cache: ['telegramFileId', 'fileName', 'mimeType', 'title', 'author', 'sourceUrl', 'license', 'publicDomain', 'note'],
      forbidden_fields: [...forbiddenPayloadFields],
      next_step: allowedByLicense
        ? 'A worker may fetch the Telegram file and run scripts/import-epub.mjs with the asserted license.'
        : 'Do not fetch or extract text. Keep metadata/linkout only until a permitted license is supplied.',
    },
  });
});

importRouter.post('/import/page-photo-ocr/preview', async (req, res) => {
  try {
    await verifyBearer(req.header('authorization'));
  } catch (error) {
    res.status(401).json({ error: error instanceof Error ? error.message : 'Unauthorized' });
    return;
  }

  const body = (req.body || {}) as OcrCandidateInput;
  const image = validateImageDataUrl(body.imageDataUrl);
  if (!image.ok) {
    res.status(400).json({ error: image.error });
    return;
  }

  const ocrText = asString(body.ocrText) || asString(body.fixtureText);
  const metadata = {
    title: asString(body.title) || 'Untitled page capture',
    author: asString(body.author) || 'Unknown author',
    source: asString(body.source) || 'Private page photo',
  };

  if (!ocrText) {
    res.json({
      status: 'needs_ocr_text',
      candidates: [],
      failure: {
        reason: 'No readable OCR text was supplied by the browser/device path.',
        message: 'The photo was accepted privately, but this production-safe v1 needs selectable OCR text from the device/browser before it can preview passages. Paste extracted text or try a clearer page.',
      },
      policy: { visibility: 'private/import-candidate', publicDiscoverIncluded: false, maxCandidates: 3 },
    });
    return;
  }

  const cleanedText = cleanOcrText(ocrText);
  const candidates = buildCandidates(cleanedText, metadata, 3);
  if (candidates.length < 1) {
    res.json({
      status: 'no_candidates',
      candidates: [],
      failure: {
        reason: 'OCR text did not pass RandomPage passage checks.',
        message: 'Try a clearer, flatter single page. We need 180–800 readable characters ending at a sentence boundary.',
        cleanedChars: cleanedText.length,
      },
      policy: { visibility: 'private/import-candidate', publicDiscoverIncluded: false, maxCandidates: 3 },
    });
    return;
  }

  res.json({
    status: 'candidate_preview',
    candidates: candidates.map((candidate) => ({ ...candidate, previewId: `preview-${candidate.index}` })),
    policy: { visibility: 'private/import-candidate', publicDiscoverIncluded: false, acceptedAction: 'save_as_private_bookmark' },
  });
});

importRouter.post('/import/page-photo-ocr/accept', async (req, res) => {
  let userId: string;
  try {
    const claims = await verifyBearer(req.header('authorization'));
    userId = claims.sub;
  } catch (error) {
    res.status(401).json({ error: error instanceof Error ? error.message : 'Unauthorized' });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const text = normalize(body.text);
  const title = asString(body.title) || 'Untitled page capture';
  const author = asString(body.author) || 'Unknown author';
  const source = asString(body.source) || 'Private page photo';
  if (!isUsablePassage(text)) {
    res.status(400).json({ error: 'Accepted candidate no longer passes private passage checks.' });
    return;
  }

  const prisma = getPrisma();
  const now = new Date();
  await upsertReader(prisma, userId, now);
  const passageId = `private-ocr-${nanoid()}`;
  const bookmarkId = nanoid();
  const tags = JSON.stringify([...new Set([...(Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : []), 'private', 'import-candidate', 'ocr-candidate', 'book-page'])]);
  await prisma.passage.create({
    data: { id: passageId, text, bookTitle: title, author, chapter: source, tags, language: 'en' },
  });
  await prisma.bookmark.create({
    data: { id: bookmarkId, userId, passageId, createdAt: now, note: 'Private page-photo OCR import candidate. Review before treating as a permanent saved passage.' },
  });
  res.json({
    status: 'saved_private_candidate',
    passage: { id: passageId, text, bookTitle: title, author, chapter: source, tags },
    bookmark: { id: bookmarkId },
    policy: { visibility: 'private/import-candidate', publicDiscoverIncluded: false, opensIn: '/bookmarks' },
  });
});
