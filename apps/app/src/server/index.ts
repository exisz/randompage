// Dev entry only — runs vite-express single-process (SPA + API + HMR).
// Production uses Vercel serverless (api/index.mjs → api-dist/server/app.js).
import 'dotenv/config';
import ViteExpress from 'vite-express';
import { createApp } from './app.js';

const app = createApp();
const port = Number(process.env.PORT || 3000);

ViteExpress.config({ mode: 'development' });
ViteExpress.listen(app, port, () => {
  console.log(`[app] vite-express dev → http://localhost:${port}`);
});
