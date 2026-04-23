# RandomPage

A daily literary discovery app — discover curated passages from classic literature.

## Architecture

Monorepo with two independent Vercel deployments:

- **Landing** (`apps/landing`) → Astro static site → `randompage.rollersoft.com.au`
- **App** (`apps/app`) → Vite/React SPA + Express/Prisma API → `app.randompage.rollersoft.com.au`

## Stack

- Landing: Astro + DaisyUI
- App: Vite + React + React Router + DaisyUI
- API: Express + Prisma + Turso (libSQL)
- Auth: Logto SSO (PKCE)
- Push: Web Push (VAPID)
- Hosting: Vercel (GitHub integration)

## Dev

```bash
pnpm install
pnpm dev:landing   # http://localhost:4321
pnpm dev:app       # http://localhost:3000
```

## Vercel Projects

| Project | Root Dir | Domain |
|---------|----------|--------|
| randompage (landing) | apps/landing | randompage.rollersoft.com.au |
| randompage-app | apps/app | app.randompage.rollersoft.com.au |
