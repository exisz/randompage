// Vercel serverless entry.
// Imports the compiled Express app from api-dist/ (tsc output), bypassing
// workspace package exports resolution + the vite-express dev wrapper.
// See ../docs/GOTCHAS.md lessons from STAR-611 for why .mjs + direct import.
import { createApp } from '../api-dist/server/app.js';

const app = createApp();

export default function handler(req, res) {
  return app(req, res);
}
