import express, { type Express } from 'express';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { passagesRouter } from './routes/passages.js';
import { bookmarksRouter } from './routes/bookmarks.js';
import { pushRouter } from './routes/push.js';
import { preferencesRouter } from './routes/preferences.js';

export function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', passagesRouter);
  app.use('/api', bookmarksRouter);
  app.use('/api', pushRouter);
  app.use('/api', preferencesRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  return app;
}
