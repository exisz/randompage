#!/usr/bin/env node
// Push the current Prisma schema to the remote Turso DB configured
// by TURSO_DATABASE_URL + TURSO_AUTH_TOKEN. Uses `vercel env pull` under the
// hood if not already exported.
//
// Run:   pnpm db:push-remote
// (Must run from the apps/app package — see root package.json script)
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const isApp = existsSync(resolve(cwd, 'prisma/schema.prisma'));
if (!isApp) {
  console.error('[db-push-remote] must run from apps/app/');
  process.exit(1);
}

if (!process.env.TURSO_DATABASE_URL) {
  console.log('[db-push-remote] TURSO_DATABASE_URL not set — trying vercel env pull...');
  try {
    execSync('vercel env pull .env.turso --token $(cat ~/.vercel_token) --scope roller', {
      stdio: 'inherit',
    });
    (await import('dotenv')).config({ path: '.env.turso' });
  } catch (e) {
    console.error('[db-push-remote] vercel env pull failed. Set TURSO_* env vars manually.');
    process.exit(1);
  }
}

console.log('[db-push-remote] pushing schema → Turso');
execSync(`prisma db push --schema=prisma/schema.prisma`, {
  stdio: 'inherit',
  env: {
    ...process.env,
    // prisma db push uses the datasource URL; swap LOCAL_ → Turso via --url won't work,
    // so we rely on PRISMA_DATABASE_URL or adapter pattern. Easiest: use libsql directly.
  },
});
