import { Router, type Request, type Response } from 'express';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import { nanoid } from 'nanoid';

export const bookmarksRouter = Router();

// GET /api/bookmarks
bookmarksRouter.get('/bookmarks', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: claims.sub as string },
      include: { passage: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ bookmarks });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/bookmarks
bookmarksRouter.post('/bookmarks', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const { passageId } = req.body;
    if (!passageId) { res.status(400).json({ error: 'passageId required' }); return; }
    const prisma = getPrisma();

    // Ensure user exists
    const userId = claims.sub as string;
    const now = new Date();
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, displayName: 'Reader', createdAt: now },
      update: {},
    });

    // Update preferences for passage tags
    const passage = await prisma.passage.findUnique({ where: { id: passageId } });
    if (passage) {
      const tags = passage.tags.split(',').map(t => t.trim()).filter(Boolean);
      for (const tag of tags) {
        const existing = await prisma.userPreference.findFirst({ where: { userId, tag } });
        if (existing) {
          await prisma.userPreference.update({
            where: { id: existing.id },
            data: { weight: existing.weight + 1, updatedAt: now },
          });
        } else {
          await prisma.userPreference.create({
            data: { id: nanoid(), userId, tag, weight: 2, updatedAt: now },
          });
        }
      }
    }

    const bookmark = await prisma.bookmark.create({
      data: { id: nanoid(), userId, passageId, createdAt: now },
    });
    res.json({ bookmark });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// DELETE /api/bookmarks/:id
bookmarksRouter.delete('/bookmarks/:id', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await prisma.bookmark.deleteMany({
      where: { id: req.params.id, userId: claims.sub as string },
    });
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
