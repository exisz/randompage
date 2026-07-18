import { Router, type Request, type Response } from 'express';
import { nanoid } from 'nanoid';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';

export const playlistsRouter = Router();

async function ensurePlaylistShareTables(prisma: ReturnType<typeof getPrisma>) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS passage_playlist_shares (
      id TEXT PRIMARY KEY NOT NULL,
      share_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS passage_playlist_shares_user_created_idx ON passage_playlist_shares(user_id, created_at)');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS passage_playlist_share_items (
      id TEXT PRIMARY KEY NOT NULL,
      playlist_id TEXT NOT NULL,
      passage_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (playlist_id) REFERENCES passage_playlist_shares(id) ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS passage_playlist_share_items_playlist_position_key ON passage_playlist_share_items(playlist_id, position)');
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS passage_playlist_share_items_passage_idx ON passage_playlist_share_items(passage_id)');
}

function normalizeTitle(value: unknown) {
  if (typeof value !== 'string') return 'RandomPage passage playlist';
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 80) : 'RandomPage passage playlist';
}

function normalizeNote(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 240) : null;
}

function normalizePassageIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    const id = String(item ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id.slice(0, 80));
    if (ids.length >= 20) break;
  }
  return ids;
}

// POST /api/playlists — create a read-only public share over existing RandomPage passage IDs.
playlistsRouter.post('/playlists', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensurePlaylistShareTables(prisma);
    const userId = claims.sub as string;
    const title = normalizeTitle(req.body?.title);
    const note = normalizeNote(req.body?.note);
    if (note === undefined) { res.status(400).json({ error: 'note must be a string or null' }); return; }
    const passageIds = normalizePassageIds(req.body?.passageIds);
    if (passageIds.length === 0) { res.status(400).json({ error: 'passageIds required' }); return; }

    const existingPassages = await prisma.passage.findMany({ where: { id: { in: passageIds } }, select: { id: true } });
    const existingIds = new Set(existingPassages.map((passage) => passage.id));
    const orderedIds = passageIds.filter((id) => existingIds.has(id));
    if (orderedIds.length === 0) { res.status(400).json({ error: 'playlist must contain existing RandomPage passages' }); return; }

    const now = new Date().toISOString();
    const playlistId = nanoid();
    const shareId = nanoid(10);
    await prisma.$executeRaw`
      INSERT INTO passage_playlist_shares (id, share_id, user_id, title, note, created_at, updated_at)
      VALUES (${playlistId}, ${shareId}, ${userId}, ${title}, ${note}, ${now}, ${now})
    `;
    for (const [index, passageId] of orderedIds.entries()) {
      await prisma.$executeRaw`
        INSERT INTO passage_playlist_share_items (id, playlist_id, passage_id, position, created_at)
        VALUES (${nanoid()}, ${playlistId}, ${passageId}, ${index + 1}, ${now})
      `;
    }
    res.json({ playlist: { shareId, title, note, passageCount: orderedIds.length, url: `/playlist/${shareId}` } });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/playlists/:shareId — public read-only passage playlist.
playlistsRouter.get('/playlists/:shareId', async (req: Request, res: Response) => {
  try {
    const shareId = String(req.params.shareId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(shareId)) { res.status(404).json({ error: 'Playlist not found' }); return; }
    const prisma = getPrisma();
    await ensurePlaylistShareTables(prisma);
    const rows = await prisma.$queryRaw<Array<{
      playlist_id: string; share_id: string; title: string; note: string | null; created_at: string;
      position: number; passage_id: string; text: string; bookTitle: string; author: string; chapter: string | null; tags: string; language: string;
    }>>`
      SELECT ps.id AS playlist_id, ps.share_id, ps.title, ps.note, ps.created_at,
             psi.position, p.id AS passage_id, p.text, p.book_title AS bookTitle, p.author, p.chapter, p.tags, p.language
      FROM passage_playlist_shares ps
      JOIN passage_playlist_share_items psi ON psi.playlist_id = ps.id
      JOIN passages p ON p.id = psi.passage_id
      WHERE ps.share_id = ${shareId}
      ORDER BY psi.position ASC
      LIMIT 25
    `;
    if (rows.length === 0) { res.status(404).json({ error: 'Playlist not found' }); return; }
    res.json({
      playlist: {
        shareId: rows[0].share_id,
        title: rows[0].title,
        note: rows[0].note,
        createdAt: rows[0].created_at,
        passages: rows.map((row) => ({
          id: row.passage_id,
          text: row.text,
          bookTitle: row.bookTitle,
          author: row.author,
          chapter: row.chapter ?? undefined,
          tags: row.tags,
          language: row.language,
          position: row.position,
        })),
      },
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
