import { Router, type Request, type Response } from 'express';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';

export const authRouter = Router();

// GET /api/me - get or create user profile
authRouter.get('/me', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();

    // In our DB user.id = logtoId (string primary key)
    const now = new Date();
    const user = await prisma.user.upsert({
      where: { id: claims.sub as string },
      create: {
        id: claims.sub as string,
        displayName: (claims['name'] as string) || (claims['email'] as string) || 'Reader',
        createdAt: now,
      },
      update: {},
    });

    res.json({ user });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(401).json({ error: msg });
  }
});
