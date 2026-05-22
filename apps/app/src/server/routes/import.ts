import { Router, type Request } from 'express';

export const importRouter = Router();

const allowedLicenses = new Set(['public-domain', 'cc0', 'cc-by', 'permission']);
const forbiddenPayloadFields = new Set(['text', 'content', 'html', 'chapters', 'epubBase64', 'base64', 'raw']);

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
    handoff: {
      telegramFileId,
      fileName,
      mimeType,
      title,
      author,
      sourceUrl,
      license,
      publicDomain,
    },
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
