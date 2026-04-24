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

// POST /api/push/send
// Auth: x-push-secret header == PUSH_SECRET (matches PLANET-951 contract)
// Behavior: per-user personalized weighted sampling, excludes recently pushed passages,
// records pushHistory, returns { sent, failed, personalized: [{userId, passageId}] }.
pushRouter.post('/push/send', async (req: Request, res: Response) => {
  try {
    const secret = process.env.PUSH_SECRET;
    const provided = req.header('x-push-secret');
    if (!secret || provided !== secret) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    // PLANET-1166 (5th attempt): kill switch to break stale-sub loop.
    // ?force_clean_failed=1 → delete ANY subscription whose webpush.send fails for ANY reason.
    // Use once to flush genuinely stale subs that don't return a clean 4xx, then drop the param.
    const forceClean = req.query.force_clean_failed === '1' || req.query.force_clean_failed === 'true';
    const prisma = getPrisma();
    const subscriptions = await prisma.pushSubscription.findMany();
    const failures: { subId: string; endpoint: string; statusCode: number | null; name: string | null; message: string | null; code: string | null; deleted: boolean }[] = [];

    // Pre-load all passages once (small dataset, ~609 rows)
    const passages = await prisma.passage.findMany();
    if (passages.length === 0) {
      res.json({ ok: true, sent: 0, failed: 0, personalized: [] });
      return;
    }

    // Group subs by user so each user gets one personalized passage per send
    const subsByUser = new Map<string, typeof subscriptions>();
    for (const s of subscriptions) {
      const arr = subsByUser.get(s.userId) ?? [];
      arr.push(s);
      subsByUser.set(s.userId, arr);
    }

    let sent = 0;
    let failed = 0;
    let removed = 0;
    const personalized: { userId: string; passageId: string }[] = [];

    for (const [userId, userSubs] of subsByUser.entries()) {
      try {
        // Build excludeIds from recent pushHistory (last 30 days)
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const recent = await prisma.pushHistory.findMany({
          where: { userId, sentAt: { gte: since } },
          select: { passageId: true },
        });
        const excludeIds = new Set(recent.map(r => r.passageId));

        // Personalized weighted sampling using user_preferences
        const prefs = await prisma.userPreference.findMany({ where: { userId } });
        const prefMap = Object.fromEntries(prefs.map(p => [p.tag, p.weight]));

        const candidates = passages.filter(p => !excludeIds.has(p.id));
        const pool = candidates.length > 0 ? candidates : passages; // fallback if all excluded

        const weights = pool.map(p => {
          const tags = p.tags.split(',').map(t => t.trim()).filter(Boolean);
          const w = tags.reduce((sum, tag) => sum + (prefMap[tag] || 1), 0);
          return { passage: p, weight: w > 0 ? w : 1 };
        });
        const totalWeight = weights.reduce((s, w) => s + w.weight, 0);
        let rand = Math.random() * totalWeight;
        let chosen = weights[0].passage;
        for (const w of weights) {
          rand -= w.weight;
          if (rand <= 0) { chosen = w.passage; break; }
        }

        // Send to all of this user's subscriptions
        let userSent = 0;
        for (const sub of userSubs) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify({
                title: 'RandomPage',
                body: chosen.text.slice(0, 100) + (chosen.text.length > 100 ? '...' : ''),
                passageId: chosen.id,
              }),
            );
            userSent++;
          } catch (err: unknown) {
            failed++;
            const e = err as { statusCode?: number; body?: string; message?: string; name?: string; code?: string };
            const statusCode = typeof e?.statusCode === 'number' ? e.statusCode : null;
            const errCode = typeof e?.code === 'string' ? e.code : null;
            // PLANET-1166 (5th attempt): also treat network-level errors (no statusCode but has err.code
            // like ENOTFOUND/ECONNRESET/EAI_AGAIN) as unrecoverable — the push endpoint host is gone.
            const isNetworkDead = statusCode === null && errCode !== null;
            const is4xx = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
            const shouldDelete = forceClean || is4xx || isNetworkDead;
            let deleted = false;
            if (shouldDelete) {
              try {
                await prisma.pushSubscription.delete({ where: { id: sub.id } });
                removed++;
                deleted = true;
              } catch { /* swallow — sub may already be gone */ }
            }
            failures.push({
              subId: sub.id,
              endpoint: sub.endpoint.slice(0, 80),
              statusCode,
              name: e?.name ?? null,
              message: e?.message ?? null,
              code: errCode,
              deleted,
            });
            console.log(`[push/send] webpush failed sub=${sub.id} statusCode=${statusCode} code=${errCode} name=${e?.name} deleted=${deleted}`);
          }
        }

        if (userSent > 0) {
          await prisma.pushHistory.create({
            data: {
              id: nanoid(),
              userId,
              passageId: chosen.id,
              sentAt: new Date(),
            },
          });
          sent += userSent;
          personalized.push({ userId, passageId: chosen.id });
        }
      } catch (outerErr: unknown) {
        failed++;
        const e = outerErr as { message?: string; name?: string; stack?: string };
        failures.push({
          subId: `user:${userId}`,
          endpoint: '(outer)',
          statusCode: null,
          name: e?.name ?? 'OuterError',
          message: (e?.message ?? String(outerErr)).slice(0, 300),
          code: null,
          deleted: false,
        });
        console.log(`[push/send] outer error user=${userId}: ${e?.name} ${e?.message}\n${e?.stack}`);
      }
    }

    res.json({ ok: true, sent, failed, removed, personalized, failures });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
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
    let removed = 0;
    for (const sub of subscriptions) {
      try {
        // Get weighted random passage for user
        const count = await prisma.passage.count();
        const skip = Math.floor(Math.random() * count);
        const [passage] = await prisma.passage.findMany({ skip, take: 1 });
        if (!passage) continue;

        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: 'RandomPage', body: passage.text.slice(0, 100) + '...', passageId: passage.id }),
          );
        } catch (err: unknown) {
          // Diagnostic logging for PLANET-1166 (3rd attempt) — capture full err shape
          const e = err as { statusCode?: number; body?: string; message?: string; name?: string };
          const statusCode = e?.statusCode;
          console.log(`[cron/daily-push] webpush failed sub=${sub.id} endpoint=${sub.endpoint.slice(0, 60)}... statusCode=${statusCode} name=${e?.name} message=${e?.message} body=${(e?.body || '').slice(0, 200)}`);
          // Auto-cleanup expired subscriptions: any 4xx is unrecoverable per Web Push RFC 8030.
          if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
            try {
              await prisma.pushSubscription.delete({ where: { id: sub.id } });
              removed++;
              console.log(`[cron/daily-push] removed expired subscription ${sub.id} (HTTP ${statusCode})`);
            } catch (delErr) {
              console.log(`[cron/daily-push] failed to delete sub ${sub.id}: ${delErr}`);
            }
          }
          continue;
        }

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
    res.json({ ok: true, sent, removed });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
