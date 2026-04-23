# BLUEPRINT.md — RandomPage 系统架构图纸

> 本文件是 RandomPage 的单一架构事实来源。所有架构变更必须先更新本文件。
> 维护者: 团长 (master agent) + Engineer Pod（每次代码架构改动后更新）
> 最后更新: 2026-04-23 — PLANET-1159 架构迁移 (Next.js → genstack-astro-spa-api-2deploys)

## 系统拓扑 (当前架构)

```
┌─────────────────────────────────────────────────────────────────┐
│  Vercel Production (两个独立 project)                            │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Project: randompage (Landing)                            │ │
│  │  URL: randompage.rollersoft.com.au                        │ │
│  │  Root: apps/landing                                       │ │
│  │  Stack: Astro static (SSG, SEO marketing)                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Project: randompage-app (SPA + API)                      │ │
│  │  URL: app.randompage.rollersoft.com.au                    │ │
│  │  Root: apps/app                                           │ │
│  │  Stack:                                                   │ │
│  │    SPA: Vite + React + React Router + DaisyUI (luxury)    │ │
│  │    API: Express + Prisma + Turso (serverless function)    │ │
│  │    Auth: Logto SSO (PKCE, @logto/browser)                 │ │
│  │    Push: Web Push (VAPID)                                 │ │
│  │  Routes:                                                  │ │
│  │    /              → Landing (→ /discover if authed)       │ │
│  │    /discover      → 发现页 (随机片段)                      │ │
│  │    /bookmarks     → 书架                                   │ │
│  │    /history       → 推送历史 (收件箱)                      │ │
│  │    /settings      → 设置/推送开关                          │ │
│  │    /callback      → Logto SSO 回调                        │ │
│  │    /api/health    → API health check                      │ │
│  │    /api/me        → 用户信息 (upsert)                     │ │
│  │    /api/passages/random → 随机片段 (支持 ?preferUnread=1) │ │
│  │    /api/bookmarks → 书签 CRUD                             │ │
│  │    /api/push/*    → 推送订阅/历史                          │ │
│  │    /api/cron/daily-push → 每日推送 (21:00 UTC)            │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Turso (生产 SQLite via libSQL)                                   │
│  DB: turso-randompage-vercel-icfg-...                            │
│  Tables: users, passages(609), bookmarks, push_subscriptions,    │
│          push_history, user_preferences, credentials, sessions   │
│  ORM: Prisma v6 + @prisma/adapter-libsql                        │
└──────────────────────────────────────────────────────────────────┘
```

## Monorepo 结构

```
exisz/randompage (GitHub)
├── apps/
│   ├── landing/          # Astro (randompage.rollersoft.com.au)
│   └── app/              # Vite/React SPA + Express API
│       ├── src/client/   # React SPA (Vite root)
│       ├── src/server/   # Express + Prisma
│       ├── api/          # Vercel serverless entry (index.mjs)
│       └── prisma/       # Schema + migrations (baseline only)
├── packages/             # (空, 预留共享包)
├── scripts/              # db-push-remote.mjs
└── pnpm-workspace.yaml
```

## 数据模型

| 表 | 说明 |
|----|------|
| users | id (text PK = logtoId), display_name, created_at |
| credentials | WebAuthn 凭证 (passkey) |
| sessions | 登录会话 (passkey 用) |
| passages | 片段库 (609 条, EN+CN) |
| bookmarks | 用户收藏 |
| push_subscriptions | Web Push 订阅 |
| push_history | 推送记录 (含 read_at 标记) |
| user_preferences | 用户偏好标签权重 |

## Vercel Projects

| Project ID | Name | Root Dir | Domain |
|-----------|------|----------|--------|
| prj_eUkucBfKgJxIRsMID5se09c4cqhE | randompage | apps/landing | randompage.rollersoft.com.au |
| prj_Ikmwzt79O6o9pppMgjyrITQoSetM | randompage-app | apps/app | app.randompage.rollersoft.com.au |

## Logto

- Endpoint: https://id.rollersoft.com.au
- App ID: tzmgozvlzhs1uxi19xiak (SPA type, PKCE)
- API Resource: https://randompage.rollersoft.com.au/api
- Redirect URIs: 
  - https://randompage.rollersoft.com.au/callback
  - https://app.randompage.rollersoft.com.au/callback
  - https://randompage-app.vercel.app/callback
  - http://localhost:3000/callback

## Cron

| Cron | Schedule | Route | 说明 |
|------|----------|-------|------|
| daily-push | `0 21 * * *` (21:00 UTC / ~7am AEST) | POST /api/cron/daily-push | 每日推送随机片段给所有 Web Push 订阅者 |

## 版本记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-04-23 | PLANET-1159: 架构迁移 Next.js → genstack-astro-spa-api-2deploys (Astro landing + Vite/React SPA + Express/Prisma API) | Engineer Pod |
| 2026-04-22 | PLANET-1094: /api/passages/random 支持 ?preferUnread=1 | Engineer Pod |
| 2026-04-12 | L1个性化推荐引擎: user_preferences 表; 加权采样 | Engineer Pod |
