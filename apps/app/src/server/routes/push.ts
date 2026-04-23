import { Router, type Request, type Response } from 'express';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import { nanoid } from 'nanoid';
import webpush from 'web-push';

export const pushRouter = Router();

// Set VAPID keys
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    'mailto:admin@rollersoft.com.au',
    vapidPublicKey,
    vapidPrivateKey,
  );
}

// POST /api/push/subscribe
pushRouter.post('/push/subscribe', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const { endpoint, p256dh, auth } = req.body;
    if (!endpoint || !p256dh || !auth) { res.status(400).json({ error: 'Missing fields' }); return; }
    const prisma = getPrisma();
    const userId = claims.sub as string;
    const now = new Date();

    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, displayName: 'Reader', createdAt: now },
      update: {},
    });

    // Upsert subscription by endpoint
    const existing = await prisma.pushSubscription.findFirst({ where: { userId, endpoint } });
    if (!existing) {
      await prisma.pushSubscription.create({
        data: { id: nanoid(), userId, endpoint, p256dh, auth, createdAt: now },
      });
    }
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/push/config
pushRouter.get('/push/config', (_req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

// GET /api/push/history
pushRouter.get('/push/history', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    const history = await prisma.pushHistory.findMany({
      where: { userId: claims.sub as string },
      include: { passage: true },
      orderBy: { sentAt: 'desc' },
      take: 50,
    });
    res.json({ history });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/cron/daily-push
pushRouter.post('/cron/daily-push', async (req: Request, res: Response) => {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.header('authorization');
    if (!secret || auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const prisma = getPrisma();
    const subscriptions = await prisma.pushSubscription.findMany({
      include: { user: true },
    });

    let sent = 0;
    for (const sub of subscriptions) {
      try {
        // Get weighted random passage for user
        const count = await prisma.passage.count();
        const skip = Math.floor(Math.random() * count);
        const [passage] = await prisma.passage.findMany({ skip, take: 1 });
        if (!passage) continue;

        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: 'RandomPage', body: passage.text.slice(0, 100) + '...', passageId: passage.id }),
        );

        await prisma.pushHistory.create({
          data: {
            id: nanoid(),
            userId: sub.userId,
            passageId: passage.id,
            sentAt: new Date(),
          },
        });
        sent++;
      } catch {
        // skip failed subscription
      }
    }
    res.json({ ok: true, sent });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
