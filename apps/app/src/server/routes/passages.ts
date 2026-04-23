import { Router, type Request, type Response } from 'express';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';

export const passagesRouter = Router();

// GET /api/passages/random?preferUnread=1
passagesRouter.get('/passages/random', async (req: Request, res: Response) => {
  try {
    const prisma = getPrisma();
    const preferUnread = req.query.preferUnread === '1';
    let userId: string | null = null;

    // Try to get user (optional auth)
    try {
      const claims = await verifyBearer(req.header('authorization'));
      userId = claims.sub as string;
    } catch {
      // anonymous
    }

    // Get passages - use weighted sampling based on user preferences if authed
    const count = await prisma.passage.count();
    if (count === 0) {
      res.status(404).json({ error: 'No passages found' });
      return;
    }

    let passage = null;

    if (userId && preferUnread) {
      // Try to find an unread passage from push history first
      const recentPush = await prisma.pushHistory.findFirst({
        where: { userId, readAt: null },
        orderBy: { sentAt: 'desc' },
        include: { passage: true },
      });
      if (recentPush) {
        // Mark it as read
        await prisma.pushHistory.update({
          where: { id: recentPush.id },
          data: { readAt: new Date() },
        });
        res.json({ passage: recentPush.passage, fromInbox: true });
        return;
      }
    }

    if (userId) {
      // Weighted random based on user preferences
      const prefs = await prisma.userPreference.findMany({ where: { userId } });
      const prefMap = Object.fromEntries(prefs.map(p => [p.tag, p.weight]));

      // Get all passages and do weighted sampling
      const passages = await prisma.passage.findMany();
      const weights = passages.map(p => {
        const tags = p.tags.split(',').map(t => t.trim());
        const weight = tags.reduce((sum, tag) => sum + (prefMap[tag] || 1), 0);
        return { passage: p, weight };
      });

      const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
      let rand = Math.random() * totalWeight;
      for (const w of weights) {
        rand -= w.weight;
        if (rand <= 0) {
          passage = w.passage;
          break;
        }
      }
      if (!passage) passage = passages[Math.floor(Math.random() * passages.length)];
    } else {
      // Pure random for anonymous
      const skip = Math.floor(Math.random() * count);
      const results = await prisma.passage.findMany({ skip, take: 1 });
      passage = results[0];
    }

    res.json({ passage });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// GET /api/passages/:id
passagesRouter.get('/passages/:id', async (req: Request, res: Response) => {
  try {
    const prisma = getPrisma();
    const passage = await prisma.passage.findUnique({ where: { id: req.params.id } });
    if (!passage) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ passage });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});
