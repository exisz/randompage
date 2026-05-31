# BLUEPRINT.md — RandomPage 系统架构图纸

> 本文件是 RandomPage 的单一架构事实来源。所有架构变更必须先更新本文件。
> 维护者: 团长 (master agent) + Engineer Pod（每次代码架构改动后更新）
> 最后更新: 2026-05-31 — PLANET-2313 daily personalized recommendation queue prototype
>
> **2026-05-23 owner direction (PLANET-1964 follow-up)**：内容获取不再以 source-safety / license 作为主轴。产品验收看「能不能 fetch 、文本能不能抽、能不能切片、Discover/推送能不能起来」。下面“source policy” 描述是现有 cron 的运作状态，不是未来验收轴。

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
│  │    /api/passages/daily-queue → 每日个性化未读队列预览       │ │
│  │    /api/passages/:id → 指定片段；push click 读回流          │ │
│  │    /api/bookmarks → 书签 CRUD + collection membership      │ │
│  │    /api/bookmark-collections → bookmark collections CRUD   │ │
│  │    /api/browsing/history → 浏览/跳过事件历史 + search UI    │ │
│  │    /api/reading/stats → 今日阅读数 + UTC streak 统计       │ │
│  │    /api/push/*    → 推送订阅/历史                          │ │
│  │    /api/cron/daily-push → 每日推送 (21:00 UTC)            │ │
│  │    /api/cron/tag-untagged → 每日 LLM 补打标 (03:00 UTC)   │ │
│  │    /api/cron/fetch-new-books → 每周拉书切片入库 (Sun UTC) │ │
│  │    /api/import/telegram-epub-handoff → Telegram EPUB 元数据 POC   │ │
│  │    /manifest.json + /manifest.webmanifest → PWA manifest         │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Turso (生产 SQLite via libSQL)                                   │
│  DB: turso-randompage-vercel-icfg-...                            │
│  Tables: users, passages(561), bookmarks, bookmark_collections, │
│          bookmark_collection_items, push_subscriptions,          │
│          push_history, browsing_events, user_preferences,        │
│          credentials, sessions, ingest_runs, passage_tag_failures│
│  ORM: Prisma v6 + @prisma/adapter-libsql (`User` @@map("users")) │
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
| bookmark_collections | 用户自定义收藏夹/知识库 collections（按 user_id 隔离） |
| bookmark_collection_items | collection ↔ bookmark membership；移除 collection 不删除 bookmark |
| push_subscriptions | Web Push 订阅 |
| push_history | 推送记录 (含 read_at 标记；notification click 通过 passageId 精确标记匹配记录) |
| browsing_events | 用户浏览/跳过事件 (view/skip + source)，push click/read 使用 source=push_inbox 回流偏好；`/api/reading/stats` 基于 view 事件计算 today count / UTC streak；每日队列打开卡片时记录 discover view |
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
- `tag-untagged` 成本控制：默认 `limit=50`、`batch=5`，可用 query/env 调整；失败 passage 记录在 `passage_tag_failures`，`retry_count >= 3` 自动跳过。LLM 返回部分无效结果时按 passage 隔离失败：同一批次里的有效 sibling rows 会照常写入 tags，不会因为一个 bad row 被整批记失败。
- `fetch-new-books` 成本控制：默认每周 `books=1`、最多 `passages=75`；内置 30 本 public-domain seed queue（Gutenberg cache + 关键书目的 GITenberg mirror）按 title+author 去重，新 passages 以 `tags='[]'` 入库，等待每日补打标。
- passage length policy (PLANET-2037/2054): 所有新增 passage 切片目标约 300 chars，允许 180–800 chars；`fetch-new-books`、`slice-epub.mjs`、`import-epub.mjs` 都使用该边界，避免 quote-sized rows 与 1k+ 多段长文进入 Discover。
- passage content policy (PLANET-2139/2227): Discover/push runtime selection and future import slicing reject standalone reference-note/footnote fragments (leading `↩`, note headings, editorial-note starts, note cross-reference starts such as `For …, see note …`, dense reference-marker clusters) and fragments ending without sentence-terminal punctuation. `pnpm check:passage-content` reports production counts + samples before any reviewed cleanup.
- `fetch-new-books` source policy：每本书使用 ordered plaintext mirrors；有 GITenberg raw mirror 的书优先 GitHub raw，全部书 fallback Project Gutenberg cache/files URLs；所有 fetch 带 `RandomPage/1.0` user-agent，全部 mirror 失败时返回 207 并记录具体 URL 错误；当 30 本 seed queue 全部已有 passages 时返回 409 并发 Discord 摘要，避免静默空转。
- 10M-book source policy (PLANET-1964): `docs/source-policy-10m-book-adapter.md` is the ADR for metadata-first Open Library + Google Books + OAIster/WorldCat discovery. Allowed cache fields are metadata/linkout/access flags; full-text passage generation requires verified public-domain/licensed content.
- Telegram EPUB handoff POC (PLANET-1966): `POST /api/import/telegram-epub-handoff` accepts only secret-protected metadata/file references and rejects raw text/base64 payloads; it returns whether a licensed worker may fetch and process the EPUB.
- Protected-source regression guard (PLANET-2101/2000): `pnpm check:source-policy` checks production Turso for known blocked modern-book full-text sources (currently Colleen Hoover / *It Ends With Us*) and fails if they reappear; `--apply` is reviewed cleanup only and refuses user-referenced rows.
- Browsing telemetry guard (PLANET-1985): `pnpm check:browsing-events-policy` verifies Discover views/skips and push-inbox reads are wired to `browsing_events(source=discover|push_inbox)` and push-click telemetry failures are not silently swallowed.
- 手动验证示例：`curl -H "Authorization: Bearer $CRON_SECRET" https://app.randompage.rollersoft.com.au/api/cron/tag-untagged?limit=5`。

## 数据维护脚本 (`apps/app/scripts/`)

| 脚本 | Ticket | 用途 |
|------|--------|------|
| `tag-passages.mjs` | PLANET-1173 | 用 Gemini Flash 给 `tags` 为空的 passage 批量打标 (genre/mood/topic/language) |
| `cleanup-boilerplate.mjs` | PLANET-1172 | 删除 Standard Ebooks / Project Gutenberg 版权/前言 boilerplate 行（DRY-RUN by default，`--apply` 才真删） |
| `check-source-policy.mjs` | PLANET-2101/2000 | 生产库 known protected-source 回归检查；review 后可 `--apply` 删除无用户引用违规行 |
| `check-browsing-events-policy.mjs` | PLANET-1985 | 静态回归检查 Discover / push-inbox telemetry 是否写入 `browsing_events` |
| `check-passage-length-policy.mjs` | PLANET-2037/2054 | 生产 corpus 长度 QA：p50/p90/p95/max、too-short/too-long samples、`--repair-plan` 分组 |
| `check-passage-content-policy.mjs` | PLANET-2139/2227 | 生产 corpus reference-note/footnote/truncated-ending QA：count + samples by reason（含 `For …, see note …` cross-reference starts 与 non-terminal endings） |
| `check-tag-failure-policy.mjs` | PLANET-2263 | 生产 corpus tag QA：报告 untagged / untagged_exhausted / failure_rows / exhausted_failure_rows 与样例，防止 retry 耗尽后静默滞留 |
| `check-schema-table-mapping.mjs` | PLANET-1914 | 生成 production-shaped snake_case SQLite fixture，验证 Prisma `User`→`users`、`push_subscriptions`、`browsing_events`、`user_preferences` 写入路径 |
| `search-source-candidates.mjs` | PLANET-1964 | Metadata-first Open Library + Google Books candidate search; emits title/author/source_url/access_depth without caching protected text |
| `import-epub.mjs` | PLANET-1965 | Local EPUB dry-run/apply pipeline; refuses full-text import unless `--license public-domain|cc0|cc-by|permission` is supplied |

两个脚本都从 env 读 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`；`tag-passages` 还需要 `GEMINI_API_KEY`（fallback `GEMINI_API_KEY_IMAGE_GENERATION_ONLY`）。详见 `apps/app/scripts/README.md`。

下次重新 ingest 后必须按顺序跑：`cleanup-boilerplate.mjs --apply` → `tag-passages.mjs`。

## 版本记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-06-01 | PLANET-2332: Discover 新增横向 tag filter chip-strip；新增 `GET /api/passages/tags?limit=N` 端点返回 top tags；`GET /api/passages/random` 新增 `?tag=` 过滤参数（加权采样限定指定 tag，tag 激活时跳过 push inbox pass-through）；选中 tag 持久化至 localStorage。 | Engineer Pod |
| 2026-05-31 | PLANET-2313: Discover 新增 “Today’s fresh pages” 每日个性化未读队列 UI；后端新增 `GET /api/passages/daily-queue?limit=5`，按 user_preferences + 最近 view/push history 过滤/加权生成每日 3–5 条 readable passage 预览，点击卡片记录 discover view。 | Engineer Pod |
| 2026-05-31 | PLANET-2290/2291: Bookmarks/History 增加移动优先 search + tag filters；Bookmarks 增加 user-owned collections（create/rename/delete、bookmark membership、collection chips/sections），后端新增 `bookmark_collections` / `bookmark_collection_items` 与 `/api/bookmark-collections` CRUD。 | Engineer Pod |
| 2026-05-30 | PLANET-2292/2293/2294: Discover 改为移动优先的视觉 passage card，新增 Web Share API / copy fallback 分享动作，并新增 `/api/reading/stats` 显示今日阅读数与当前 UTC streak；匿名用户显示 sign-in habit prompt。 | Engineer Pod |
| 2026-05-30 | PLANET-2263: `tag-untagged` LLM partial result 改为按 passage 隔离失败；新增 `pnpm check:tag-failures` QA 报告 untagged/exhausted retry rows；生产 5 条 Sherlock Holmes exhausted untagged rows 已重置并重新打标。 | Engineer Pod |
| 2026-05-29 | PLANET-2227: passage content policy 新增 non-terminal-ending 检测；Discover/push runtime 过滤历史硬截断片段；fetch-new-books / import-epub / slice-epub 改为句末边界切片，避免未来 passage 以 mid-word/mid-sentence 结尾。 | Engineer Pod |
| 2026-05-28 | PLANET-2139 follow-up: reference-note policy 扩展到 `For …, see note …` / `See note …` / `Cf. note …` cross-reference starts；生产 QA 从 1 条候选扩展识别到 id=43、346、348 共 3 条，runtime/import/push 同步过滤。 | Engineer Pod |
| 2026-05-27 | PLANET-2139: 新增 reference-note/footnote fragment content policy；Discover/push runtime selection 与 `fetch-new-books`/EPUB slicer/importer 均过滤 leading `↩`、note headings、editorial-note starts、reference-marker clusters；新增 `pnpm check:passage-content` 生产 corpus QA。 | Engineer Pod |
| 2026-05-26 | PLANET-2101: 恢复 `pnpm check:source-policy` + `apps/app/scripts/check-source-policy.mjs`，用于 known protected modern-book full-text 回归检查；脚本从 env 或 `.env.local` 读取 Turso 凭证，`--apply` 仅删除无用户引用违规行。 | Engineer Pod |
| 2026-05-24 | PLANET-2037/2054: 新增 passage length policy（目标约 300 chars，允许 180–800 chars），收紧 `fetch-new-books`/EPUB slicer/importer 下限与上限，并新增 `pnpm check:passage-lengths` corpus QA + repair-plan 报告。 | Engineer Pod |
| 2026-05-23 | PLANET-1985/1958: push click telemetry 不再吞掉 `recordInteraction` 错误；新增 browsing-events policy check；`/manifest.webmanifest` 作为 `/manifest.json` 别名随静态资源发布。 | Engineer Pod |
| 2026-05-22 | PLANET-1964/1965/1966: 新增 10M-book metadata-first source policy ADR、Open Library/Google Books candidate search POC、EPUB-first local import script，以及 secret-protected Telegram EPUB handoff API (`/api/import/telegram-epub-handoff`)；所有路径默认禁止缓存 protected full text。 | Engineer Pod |
| 2026-05-21 | PLANET-1914: Prisma `User` model 显式 `@@map("users")` 对齐生产 Turso `users` 表，并新增 `check:schema-mapping` smoke 覆盖 authenticated user upsert、push subscription、browsing event、user preference 等 snake_case 表写入路径。 | Engineer Pod |
| 2026-05-20 | PLANET-1878: Service Worker notification click 保留 passageId，Discover 加载 /api/passages/:id?source=push；认证用户点击推送会精确标记 matching push_history.read_at 并写 browsing_events(source=push_inbox)，防止多条未读推送时归因漂移。 | Engineer Pod |
| 2026-05-19 | PLANET-1835: `fetch-new-books` 书源从 3 本扩展为 30 本 public-domain seed queue，并在队列耗尽时返回 409 + Discord observability，避免 weekly cron 静默空转。 | Engineer Pod |
| 2026-05-18 | PLANET-1827: `fetch-new-books` 书源改为 ordered plaintext mirrors（GitHub raw GITenberg primary + Gutenberg fallback）并加入 user-agent/短文本校验，避免生产环境 Gutenberg URL 不稳定导致 processed=1 inserted=0 failed=1。 | Engineer Pod |
| 2026-05-18 | PLANET-1114/1113/1112: 新增 `routes/cron.ts` 数据管线 cron：weekly `fetch-new-books` 拉 public-domain plaintext 书单并切片入库、daily `tag-untagged` 调 Gemini 给空 tags 批量打标并用 `passage_tag_failures.retry_count` 重试/跳过；两个 cron 均支持 Discord webhook 摘要通知；`vercel.json` 注册对应 schedules。 | Engineer Pod |
| 2026-04-23 | PLANET-1172/1173: 提交 `apps/app/scripts/{tag-passages,cleanup-boilerplate}.mjs` + README；扩展 boilerplate 分类器（new patterns: "first edition of this ebook", "makes no representations", "volunteer-driven Standard Ebooks", "check for updates"）；apply 后清掉 2 行残留 boilerplate（id=342,344），passages 545→543，empty-tag rate=0%，boilerplate rate=0% | Engineer Pod |
| 2026-04-23 | PLANET-1159: 架构迁移 Next.js → genstack-astro-spa-api-2deploys (Astro landing + Vite/React SPA + Express/Prisma API) | Engineer Pod |
| 2026-04-22 | PLANET-1094: /api/passages/random 支持 ?preferUnread=1 | Engineer Pod |
| 2026-04-12 | L1个性化推荐引擎: user_preferences 表; 加权采样 | Engineer Pod |
