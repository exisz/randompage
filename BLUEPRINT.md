# BLUEPRINT.md — RandomPage 系统架构图纸

> 本文件是 RandomPage 的单一架构事实来源。所有架构变更必须先更新本文件。
> 维护者: 团长 (master agent) + Engineer Pod（每次代码架构改动后更新）
> 最后更新: 2026-05-18 — PLANET-1114/1113/1112 数据管线 Cron

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
│  │    /history       → 浏览历史 + 推送收件箱                  │ │
│  │    /settings      → 设置/推送开关                          │ │
│  │    /callback      → Logto SSO 回调                        │ │
│  │    /api/health    → API health check                      │ │
│  │    /api/me        → 用户信息 (upsert)                     │ │
│  │    /api/passages/random → 随机片段 + view/skip 记录        │ │
│  │    /api/bookmarks → 书签 CRUD                             │ │
│  │    /api/browsing/history → 浏览/跳过事件历史               │ │
│  │    /api/push/*    → 推送订阅/历史                          │ │
│  │    /api/cron/daily-push → 每日推送 (21:00 UTC)            │ │
│  │    /api/cron/tag-untagged → 每日 LLM 补打标 (03:00 UTC)   │ │
│  │    /api/cron/fetch-new-books → 每周拉书切片入库 (Sun UTC) │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Turso (生产 SQLite via libSQL)                                   │
│  DB: turso-randompage-vercel-icfg-...                            │
│  Tables: users, passages(543), bookmarks, push_subscriptions,    │
│          push_history, browsing_events, user_preferences,        │
│          credentials, sessions, ingest_runs, passage_tag_failures│
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
| passages | 片段库 (543 条, EN+CN, 100% tagged, boilerplate-free) |
| bookmarks | 用户收藏 |
| push_subscriptions | Web Push 订阅 |
| push_history | 推送记录 (含 read_at 标记) |
| browsing_events | 用户浏览/跳过事件 (view/skip + source)，用于行为历史和偏好回流 |
| user_preferences | 用户偏好标签权重（收藏与浏览提高 tag 权重，skip 降低 tag 权重下限到 1） |
| ingest_runs | 数据管线拉书入库运行记录（slug/title/source_url/inserted_count） |
| passage_tag_failures | LLM 打标失败重试计数，`retry_count >= 3` 后跳过 |

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
| daily-push | `0 21 * * *` (21:00 UTC / ~7am AEST) | GET/POST /api/cron/daily-push | 每日推送个性化片段给所有 Web Push 订阅者 |
| tag-untagged | `0 3 * * *` | GET/POST /api/cron/tag-untagged | 每日扫描 `tags` 为空的 passages，调用 Gemini 批量打标，失败写 `passage_tag_failures.retry_count`，超过 3 次跳过 |
| fetch-new-books | `0 0 * * 0` | GET/POST /api/cron/fetch-new-books | 每周从内置 public-domain 书单拉取未入库书籍（Project Gutenberg plaintext），清洗/切片后写入 `passages(tags='[]')`，由 tag cron 后续补标 |

## 数据管线运维

- 所有 cron route 使用 `CRON_SECRET` 鉴权：`Authorization: Bearer $CRON_SECRET`（也兼容 `x-cron-secret`）。
- 可观测性：`RANDOMPAGE_DISCORD_WEBHOOK_URL`（fallback `DISCORD_WEBHOOK_URL`）存在时，`fetch-new-books` / `tag-untagged` 会发送 cron 名、处理条数、净增/打标数、失败数、耗时与截断错误。
- `tag-untagged` 成本控制：默认 `limit=50`、`batch=5`，可用 query/env 调整；失败 passage 记录在 `passage_tag_failures`，`retry_count >= 3` 自动跳过。
- `fetch-new-books` 成本控制：默认每周 `books=1`、最多 `passages=75`；新 passages 以 `tags='[]'` 入库，等待每日补打标。
- 手动验证示例：`curl -H "Authorization: Bearer $CRON_SECRET" https://app.randompage.rollersoft.com.au/api/cron/tag-untagged?limit=5`。

## 数据维护脚本 (`apps/app/scripts/`)

| 脚本 | Ticket | 用途 |
|------|--------|------|
| `tag-passages.mjs` | PLANET-1173 | 用 Gemini Flash 给 `tags` 为空的 passage 批量打标 (genre/mood/topic/language) |
| `cleanup-boilerplate.mjs` | PLANET-1172 | 删除 Standard Ebooks / Project Gutenberg 版权/前言 boilerplate 行（DRY-RUN by default，`--apply` 才真删） |

两个脚本都从 env 读 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`；`tag-passages` 还需要 `GEMINI_API_KEY`（fallback `GEMINI_API_KEY_IMAGE_GENERATION_ONLY`）。详见 `apps/app/scripts/README.md`。

下次重新 ingest 后必须按顺序跑：`cleanup-boilerplate.mjs --apply` → `tag-passages.mjs`。

## 版本记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-05-18 | PLANET-1114/1113/1112: 新增 `routes/cron.ts` 数据管线 cron：weekly `fetch-new-books` 拉 public-domain plaintext 书单并切片入库、daily `tag-untagged` 调 Gemini 给空 tags 批量打标并用 `passage_tag_failures.retry_count` 重试/跳过；两个 cron 均支持 Discord webhook 摘要通知；`vercel.json` 注册对应 schedules。 | Engineer Pod |
| 2026-04-23 | PLANET-1172/1173: 提交 `apps/app/scripts/{tag-passages,cleanup-boilerplate}.mjs` + README；扩展 boilerplate 分类器（new patterns: "first edition of this ebook", "makes no representations", "volunteer-driven Standard Ebooks", "check for updates"）；apply 后清掉 2 行残留 boilerplate（id=342,344），passages 545→543，empty-tag rate=0%，boilerplate rate=0% | Engineer Pod |
| 2026-04-23 | PLANET-1159: 架构迁移 Next.js → genstack-astro-spa-api-2deploys (Astro landing + Vite/React SPA + Express/Prisma API) | Engineer Pod |
| 2026-04-22 | PLANET-1094: /api/passages/random 支持 ?preferUnread=1 | Engineer Pod |
| 2026-04-12 | L1个性化推荐引擎: user_preferences 表; 加权采样 | Engineer Pod |
