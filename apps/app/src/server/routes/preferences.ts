import { Router, type Request, type Response } from 'express';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';

export const preferencesRouter = Router();

// GET /api/preferences
preferencesRouter.get('/preferences', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    const prefs = await prisma.userPreference.findMany({
      where: { userId: claims.sub as string },
      orderBy: { weight: 'desc' },
    });
    res.json({ preferences: prefs });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
