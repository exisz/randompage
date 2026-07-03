# BLUEPRINT.md — RandomPage 系统架构图纸

> 本文件是 RandomPage 的单一架构事实来源。所有架构变更必须先更新本文件。
> 维护者: 团长 (master agent) + Engineer Pod（每次代码架构改动后更新）
> 最后更新: 2026-06-30 — PLANET-3275 Media Session lock-screen controls for listening
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
│  │    /discover      → 发现页 (随机片段 + Today fresh pages hands-free listening queue)                      │ │
│  │    /bookmarks     → 书架 + Recall Cards + Themed Review（tag/collection/natural-language topic over saved passages）                                   │ │
│  │    /history       → 浏览历史 + 推送收件箱（日分组 timeline + saved/push cards support Listen） │ │
│  │    /today         → PWA-friendly Today shortcut/latest pushed passage │ │
│  │    /source?title=...&author=... → book/source detail view with same-book passages │ │
│  │    /settings      → 设置/推送开关 + reading goals 个性化种子 │ │
│  │    /callback      → Logto SSO 回调                        │ │
│  │    /api/health    → API health check                      │ │
│  │    /api/me        → 用户信息 (upsert)                     │ │
│  │    /api/passages/random → 随机片段 + view/skip 记录        │ │
│  │    /api/passages/daily-queue → 每日个性化未读队列预览；unread exhausted 时 fallback 到 not-recent/readable existing passages，并返回 emptyReason/counts │ │
│    /api/reading-path → 7-day goal-based existing-passage path │ │
│  │    /api/daily-review → 收藏片段 Daily Review / themed revisit action; applies per-user review tuning controls │ │
│  │    /api/passages/:id → 指定片段；push click 读回流          │ │
│  │    POST /api/passages/:id/feedback → explicit feedback chips write browsing_events + bounded tag preferences │ │
│  │    /api/book-source → 同 bookTitle/author 的 existing passages；登录态 unread-first + saved/read flags + saved note snippets for export │ │
│  │    /api/bookmarks → 书签 CRUD + collection membership      │ │
│  │    /api/bookmarks/recall-search → fuzzy idea search over user-owned saved/history/push passages │ │
│  │    /api/bookmarks/:id/related → deterministic related saved pages for review cards │ │
│  │    /api/bookmarks/:id/annotations → private line-level thoughts on saved passages │ │
│  │    /api/bookmark-collections → bookmark collections CRUD   │ │
│  │    /api/browsing/history → 浏览/跳过事件历史 + search UI    │ │
│  │    /api/reading/stats → 今日阅读数 + UTC streak 统计       │ │
│    /api/reading/challenges → lightweight challenge/achievement progress derived from browsing_events, passage_reviews, reading_paths, push_history, user_preferences │ │
│  │    /api/preferences → 读取偏好权重 + goals/avoid tags + daily push schedule + read-later email 控制     │ │
│  │    /api/push/*    → 推送订阅/历史                          │ │
│  │    /api/cron/daily-push → 每日推送 (21:00 UTC)            │ │
│  │    /api/cron/tag-untagged → 每日 LLM 补打标 (03:00 UTC)   │ │
│  │    /api/cron/fetch-new-books → 每周拉书切片入库 (Sun UTC) │ │
│  │    /api/import/telegram-epub-handoff → Telegram EPUB 元数据 POC   │ │
│  │    /manifest.json + /manifest.webmanifest → PWA manifest + Today shortcut │ │
│  │    /sw.js          → offline shell/static cache + push click handler │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Turso (生产 SQLite via libSQL)                                   │
│  DB: turso-randompage-vercel-icfg-...                            │
│  Tables: users, passages, bookmarks, bookmark_collections,      │
│          bookmark_collection_items, passage_reviews,             │
│          passage_annotations, passage_recall_cards,             │
│          push_subscriptions, push_history, browsing_events,      │
│          user_preferences, reading_paths,                       │
│          passage_recall_reviews, credentials, sessions, ingest_runs, passage_tag_failures│
│  ORM: Prisma v6 + @prisma/adapter-libsql (`User` @@map("users")) │
└──────────────────────────────────────────────────────────────────┘
```

> Corpus count is intentionally not hard-coded in the topology. Use `pnpm --filter @randompage/app check:passage-content` for the current production count; PLANET-3106 verified `total=746` on 2026-06-24.

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
| bookmarks | 用户收藏；`note` 字段保存该用户对 saved passage 的私密笔记/反思（user-passage relationship，不写到 passages 全局内容） |
| bookmark_collections | 用户自定义收藏夹/知识库 collections（按 user_id 隔离）；`purpose` 可选私密用途/场景说明，用于 saved-passage pack 的 Bookmarks 展示与 Recall Search deterministic matching |
| bookmark_collection_items | collection ↔ bookmark membership；移除 collection 不删除 bookmark |
| passage_reviews | Daily Review / Themed Review / Recall Cards 复习记录（reviewed/review_later/skip、reviewed_at、due_after、box），按 user_id + bookmark_id 隔离，避免同一收藏立即重复出现；box 支持 increasing-interval ladder |
| passage_annotations | 用户对 saved passage 内具体选中文本的私密 line-level thoughts；保存 quote、start_offset/end_offset、note，按 user_id + bookmark_id 隔离，可独立 edit/delete |
| passage_recall_cards | 用户从 saved passage 选中短语创建的私密 active-recall cloze cards；保存 quote offsets、hidden context、due_after、box，按 user_id/bookmark_id 隔离 |
| passage_recall_reviews | active-recall card grading history（remembered/forgot/soon/later/someday）与下次 due_after/box，用于调度方向验证 |
| push_subscriptions | Web Push 订阅 |
| push_history | 推送记录 (含 read_at 标记；notification click 通过 passageId 精确标记匹配记录) |
| offline localStorage cache | Client-side cached last saved passages + browsing/push inbox responses after online sync; read-only fallback for offline Bookmarks/History. |
| recommendation explanation payload | `whyPersonalized` is returned on Discover passage, Daily Queue, browsing history, and push history responses when user_preferences overlap passage tags; UI renders compact “Why this page?” / High-Good match labels. |
| recall search result | `/api/bookmarks/recall-search` builds an in-memory, per-request candidate set from the signed-in user’s bookmarks, private notes, line-level annotation quote/note text, collection names, browsing history, and push inbox, then deterministic fuzzy-scores text/title/author/tags/note/annotations/collections. Queries and passage text stay inside RandomPage; no external LLM/embedding provider is used. |
| browsing_events | 用户浏览/跳过事件 (view/skip + source) 与 explicit feedback chips (`more_like_this` / `less_like_this` / `too_dense` / `different_topic`)，push click/read 使用 source=push_inbox 回流偏好；`/api/reading/stats` 基于 view 事件计算 today count / UTC streak；`/api/reading/challenges` 派生 Daily 3 pages / push-inbox challenge progress；每日队列打开卡片时记录 discover view |
| user_preferences | 用户偏好标签权重（Settings reading goals 可把预设 tag seed 到权重 7；收藏/浏览/More like this 提高 tag 权重，skip/Less like this/Different-topic 以 1–12 bounded weight 调整；`too_dense` 只记录事件不隐藏 saved content；`avoid:<tag>` 负权重行保存 “Avoid for now” soft down-rank 控制；`control:daily-push:*` 行保存用户 daily passage delivery hour/timezone；`control:review-tuning:*` 行保存 Daily Review 全局/书源/tag 的 pause/less/more 私密频率控制，不参与 Discover 推荐打分） |
| reading_paths | 用户当前/历史 7-day goal-based reading path；保存 topic/goal_id、7 个 existing passage IDs、started_at 与 completed/skipped day JSON，Discover 渲染 Day N/7 与 upcoming teasers；不存 generated summaries/courses |
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
- `tag-untagged` 成本控制：默认 `limit=50`、`batch=5`，可用 query/env 调整；失败 passage 记录在 `passage_tag_failures`，`retry_count >= 3` 自动跳过。LLM 返回部分无效结果时按 passage 隔离失败：同一批次里的有效 sibling rows 会照常写入 tags，不会因为一个 bad row 被整批记失败。若 Gemini 返回 credit/quota/billing 429 或单条结果 tags 过少，cron 会 fail-open 到 deterministic local fallback tags、在 summary/Discord 中报告 `fallbackTagged`，并清理对应 failure rows，避免 tags=[] backlog 因 provider billing/LLM quality 静默搁浅。Discover `/api/passages/random` 与 daily queue 默认优先 tagged readable passages；只有显式 `allowUntagged=1` 或全库无 tagged readable fallback 时才会从 tags=[] pool 选取。
- `fetch-new-books` 成本控制：默认每周 `books=1`、最多 `passages=75`；内置 30 本 public-domain seed queue（Gutenberg cache + 关键书目的 GITenberg mirror）按 title+author 去重，新 passages 以 `tags='[]'` 入库，等待每日补打标。
- passage length policy (PLANET-2037/2054): 所有新增 passage 切片目标约 300 chars，允许 180–800 chars；`fetch-new-books`、`slice-epub.mjs`、`import-epub.mjs` 都使用该边界，避免 quote-sized rows 与 1k+ 多段长文进入 Discover。
- passage content policy (PLANET-2139/2227/2522): Discover/push runtime selection and future import slicing reject standalone reference-note/footnote fragments (leading `↩`, note headings, editorial-note starts, note cross-reference starts such as `For …, see note …`, dense reference-marker clusters), table-of-contents/chapter-list fragments (repeated `CHAPTER`/`Book`/`Part` headings with little prose), and fragments ending without sentence-terminal punctuation. `pnpm check:passage-content` reports production counts + samples by reason before any reviewed cleanup. PLANET-2948 production cleanup deleted 190 unreferenced unreadable rows; the intentional remaining threshold is 39 non-terminal rows that already belong to user records (push_history/bookmarks), so they are excluded from destructive cleanup while runtime selection continues to filter them from new recommendations/deliveries.
- `fetch-new-books` source policy：每本书使用 ordered plaintext mirrors；有 GITenberg raw mirror 的书优先 GitHub raw，全部书 fallback Project Gutenberg cache/files URLs；所有 fetch 带 `RandomPage/1.0` user-agent，全部 mirror 失败时返回 207 并记录具体 URL 错误；当 30 本 seed queue 全部已有 passages 时返回 409 并发 Discord 摘要，避免静默空转。
- 10M-book source policy (PLANET-1964): `docs/source-policy-10m-book-adapter.md` is the ADR for metadata-first Open Library + Google Books + OAIster/WorldCat discovery. Allowed cache fields are metadata/linkout/access flags; full-text passage generation requires verified public-domain/licensed content.
- IA OCR reviewed ingest (PLANET-2508): `pnpm --filter @randompage/app ingest:ia-ocr` reads an explicit reviewed item list, serially fetches IA metadata + reviewed OCR/plaintext files, applies 180–800 char length/content checks, and dry-runs by default with report/sample output. `--apply --ack-reviewed` is required for tiny Turso inserts; rows enter `passages` with `tags='[]'` for later tag cron.
- Telegram EPUB handoff POC (PLANET-1966): `POST /api/import/telegram-epub-handoff` accepts only secret-protected metadata/file references and rejects raw text/base64 payloads; it returns whether a licensed worker may fetch and process the EPUB.
- Protected-source regression guard (PLANET-2101/2000): `pnpm check:source-policy` checks production Turso for known blocked modern-book full-text sources (currently Colleen Hoover / *It Ends With Us*) and fails if they reappear; `--apply` is reviewed cleanup only and refuses user-referenced rows.
- Browsing telemetry guard (PLANET-1985): `pnpm check:browsing-events-policy` verifies Discover views/skips and push-inbox reads are wired to `browsing_events(source=discover|push_inbox)` and push-click telemetry failures are not silently swallowed.
- Push subscription timestamp guard (PLANET-2517): `push_subscriptions.created_at` is a legacy INTEGER unix-seconds column in production. `/api/push/subscribe`, `/api/push/send`, and `/api/cron/daily-push` normalize accidental ISO text rows before Prisma reads and write new subscription rows via raw SQL with unix seconds; `pnpm check:push-policy` guards this path.
- 手动验证示例：`curl -H "Authorization: Bearer $CRON_SECRET" https://app.randompage.rollersoft.com.au/api/cron/tag-untagged?limit=5`。

## Daily Push Schedule

- Settings → Push Notifications exposes a mobile-first “Daily passage time” control for signed-in users. It stores a one-hour local delivery window as `control:daily-push:hour` and `control:daily-push:tz:<timezone>` rows in `user_preferences`, so no new table/migration is required.
- `splitPreferenceControls()` excludes `control:*` rows from recommendation preference maps; schedule controls never weight passage selection.
- `/api/push/send` and `/api/cron/daily-push` respect configured user windows by default. Users without a schedule remain due, preserving the legacy fixed-cron behavior. QA/Product smoke tests may pass `?override_schedule=1` or header `x-push-override-schedule: 1` to exercise delivery outside the configured window.
- Push history is unchanged: a sent scheduled passage still writes one per-user `push_history` record and opens to the delivered passage.

## PWA / Offline

- Service worker `apps/app/src/client/public/sw.js` caches navigations/app shell and static assets so `/discover`, `/bookmarks`, `/history`, `/settings` can render offline after a successful online session.
- Client offline helper `apps/app/src/client/lib/offline.ts` persists the last 30 bookmarks and last 30 browsing/push history entries in localStorage after authenticated online loads.
- Offline Bookmarks/History are read-only and show explicit cached/offline banners; cached saved/queued/history/push-inbox passage cards explicitly keep browser Web Speech Listen controls available offline (device voice permitting, no downloaded audio), while Discover shows a graceful network-required message for fresh recommendations instead of a blank/broken state.
- Static regression: `pnpm --filter @randompage/app check:offline-cache` (covers cached listening copy and no-audio-download browser-speech notice).

## Saved-Passage Private Notes

- `bookmarks.note` stores the signed-in user’s optional private note/reflection on a saved passage. Notes belong to the user-bookmark relationship, not to `passages`, so another user cannot see or overwrite them.
- `PATCH /api/bookmarks/:id/note` updates or clears only an owned bookmark after auth; runtime `ensureBookmarkNotesColumn` adds the nullable `note` column for existing Turso tables before reads/writes.
- Bookmarks renders inline private-note edit/save/clear controls; Daily Review/Themed Review/Recall Cards show a compact “Your private note” snippet when a saved passage resurfaces. Offline cached Bookmarks remains read-only.
- Static regression: `pnpm --filter @randompage/app check:bookmark-notes`.

## Saved-Passage Recall Cards

- `apps/app/src/client/pages/Bookmarks.tsx` exposes an optional mobile-first Recall Cards mode for due saved passages. The card shows title/author/chapter plus the prompt “What idea did this page contain?” before revealing the passage body.
- Recall actions reuse the existing `POST /api/daily-review/:bookmarkId` / `passage_reviews` path: `reviewed` advances the spaced-review box ladder, `review_later` returns tomorrow without advancing, and `skip` steps back sooner. No new table or scheduler is introduced.
- Daily Review (Discover), Themed Review, and Recall Cards read the actual POST response (`review.dueAfter` / `intervalDays` / `box`) and surface a lightweight next-review confirmation such as “Nice — next review in ~2 weeks” or “back tomorrow”; the UI does not hardcode cadence.
- Empty/anonymous boundaries: Bookmarks remains auth-gated; no saved passages shows a clean Discover CTA; offline cached mode disables mutation controls.
- Static regression: `pnpm --filter @randompage/app check:recall-cards`.

## Line-Level Thought Annotations

- Bookmarks saved-passage cards allow signed-in users to select exact passage text and save a private thought anchored to that quote/range. This is sub-passage annotation only over existing saved RandomPage book passages.
- `passage_annotations` stores `user_id`, `bookmark_id`, `passage_id`, `quote`, `start_offset`, `end_offset`, `note`, timestamps; inline DDL creates the table/indexes at runtime. Ownership checks scope create/edit/delete to the signed-in user's bookmark.
- Annotations render beneath the saved passage as quote + note chips and can be edited/deleted independently from the whole-passage `bookmarks.note`.
- Recall search indexes annotation quote/note text alongside private notes, collections, history, and push inbox.
- Static regression: `pnpm --filter @randompage/app check:passage-annotations`.

## Active Recall Mastery Cards

- Bookmarks saved-passage text selection can create a private active-recall cloze card from an exact phrase/range. Cards remain linked to the owned bookmark and original existing RandomPage passage.
- `passage_recall_cards` and `passage_recall_reviews` are inline-DDL tables scoped by `user_id`; no public/social flashcard marketplace, AI quiz generation, summaries, or new content source is introduced.
- Bookmarks exposes an “Active Recall Mastery” practice surface: before reveal it hides the selected phrase in local context; after reveal it shows the quote, original passage, Listen/Share/Card/Open actions, and grading buttons Remembered/Forgot/Soon/Later/Someday.
- Recall grading updates the card `due_after`/`box`: Remembered advances using the existing spaced-review ladder, Forgot/Soon bring it back sooner, Later returns soon, and Someday is capped at ~60 days.
- Static regression: `pnpm --filter @randompage/app check:active-recall`.

## Daily Review Frequency Tuning

- Bookmarks exposes a signed-in Review tuning card for global saved pages, book/source (`bookTitle::author`), and tag/topic scopes. Presets are Pause / Less often / Normal / More often.
- Tuning is private per user and stored in existing `user_preferences` control rows (`control:review-tuning:global`, `control:review-tuning:source:<encoded title::author>`, `control:review-tuning:tag:<encoded tag>`), so no new table/migration is introduced.
- `GET /api/daily-review` still respects spaced-repetition `due_after` first, then excludes paused scopes and ranks due saved passages with less/more multipliers. Returned cards include a compact tuning reason when priority changed.
- Bookmarks Themed Review applies the same pause/priority controls client-side over the signed-in user’s already-saved RandomPage book passages; Bookmarks and Recall Search visibility are unaffected.
- Static regression: `pnpm --filter @randompage/app check:review-tuning`.

## Fuzzy Recall Search

- Daily Review, Themed Review, and Recall Cards expose a “Related saved pages” branch from the current review card. `GET /api/bookmarks/:id/related` seeds deterministic matching from the owned bookmark’s title/author/tags/private note/line-level thoughts/excerpt, searches only the signed-in user’s saved RandomPage passages, excludes the current passage, and returns 3–5 results with match reasons/snippets plus existing open/listen/share/card/queue/review actions. No external LLM/embedding provider, summaries, or new content source is introduced.
- Bookmarks exposes “Recall search / Find by idea” as a separate natural-language/fuzzy retrieval surface from exact saved-passage search. It is designed for remembered ideas (“power corrupting good intentions”) rather than exact words or tags.
- `GET /api/bookmarks/recall-search?q=` searches only the signed-in user’s own RandomPage library graph: bookmarks (including private notes, line-level annotation quote/note text, collection names, and private collection purpose text), browsing history, and push inbox. It returns title/author, snippet, source badges, and match reasons; no query or passage text leaves RandomPage.
- Results reuse existing passage actions where possible: open exact passage, Listen, Share, Card, Add to queue, and Save when the matching passage came from history/push rather than bookmarks.
- Offline/cached Bookmarks remains graceful: the exact client-side search still works over cached saved passages when the recall endpoint is unavailable.
- Static regression: `pnpm --filter @randompage/app check:recall-search`.

## Lightweight Reading Challenges

- Discover renders a signed-in “Reading challenges” panel with 5 fixed personal progress loops: Daily 3 pages, Weekly saved review, 7-day path progress, Open pushed page, and Explore favorite topic.
- `GET /api/reading/challenges` derives progress from existing source-of-truth tables only: `browsing_events`, `passage_reviews`, raw `reading_paths`, `push_history`, and `user_preferences`. No social leaderboard, monetization, summaries, or duplicate achievement event table is introduced.
- Rewards are textual/visual badges and progress bars only; completion updates when existing actions occur (view/listen passage, review saved passage, open pushed passage, read current path/favorite-topic passage).
- Static regression: `pnpm --filter @randompage/app check:reading-challenges`.


## User-Curated Reading Queue

- Discover current passage cards and Bookmarks saved passage cards expose “Add to queue” for existing RandomPage book passages only.
- The MVP queue is a device-local user-curated playlist stored in `localStorage` (`randompage_my_reading_queue_v1`) with ordered `addedAt` entries; no new backend table, content source, summaries, social feed, or payment/offline packaging is introduced.
- Bookmarks renders the “My Queue” section with queued passage title/author/excerpt/tags, per-item Listen/Share/Card controls, remove-one, and clear-queue actions. Removing a queued item never deletes bookmarks/history records.
- Static regression: `pnpm --filter @randompage/app check:reading-queue`.

## History Day-Grouped Timeline

- `apps/app/src/client/pages/History.tsx` groups the currently filtered History tab rows by the user’s local calendar day: Today, Yesterday, then `YYYY-MM-DD`.
- Browsing rows use `browsing_events.createdAt`; Push inbox rows use `readAt` when a pushed passage has been opened and fall back to `sentAt` for unread deliveries, preserving the existing source badges, search/tag filters, empty states, and offline cached History behavior.
- Static regression: `pnpm --filter @randompage/app check:history-day-grouping`.

## Passage Listen Controls

- `apps/app/src/client/components/ListenControl.tsx` uses the browser Web Speech API (`speechSynthesis` + `SpeechSynthesisUtterance`) for v1 read-aloud; no paid TTS backend, generated audio storage, or content pipeline is introduced.
- `apps/app/src/client/lib/mediaSession.ts` bridges active passage listening to the browser Media Session API when available: metadata uses existing passage title/author plus RandomPage artwork, action handlers are best-effort (`play`/`pause`/`stop`/`previous`/`next`), and unsupported browsers silently keep in-app controls.
- Discover current passage cards, Bookmarks saved/themed-review cards, and History browsing/push-inbox cards render the reusable Listen/Pause/Resume/Stop control when passage text is present. Discover also exposes a hands-free Start daily listening queue for Today’s fresh pages: browser speech plays the personalized 3–5 existing passages in sequence with pause/resume/next/stop, updates Media Session metadata as the active passage changes, opens each active passage through `/api/passages/:id?source=discover`, and highlights the currently spoken sentence/paragraph on the active card using speech boundary events with a first-chunk fallback, therefore recording the existing Discover view interaction instead of introducing a new audio/content model.
- Unsupported browsers or devices without an installed voice get an inline fallback notice while the normal reading UI remains usable.
- Static regressions: `pnpm --filter @randompage/app check:listen-control` and `pnpm --filter @randompage/app check:daily-queue`.
- Daily queue fallback policy: `/api/passages/daily-queue?limit=5` first prefers unread/avoid-free readable passages, then unread with avoided tags if needed, then personalized read-but-not-recent passages, and finally any readable existing RandomPage passage. If truly empty, response includes `emptyReason` + counts and Discover shows a retry action instead of stale sign-in-sync copy.

## Passage Sharing

- `apps/app/src/client/components/SharePassageButton.tsx` uses the Web Share API when available and falls back to copying a formatted passage snippet to clipboard.
- `apps/app/src/client/components/SharePassageImageButton.tsx` renders a mobile-friendly PNG quote card client-side with canvas; the card contains only existing passage text, title/author, subtle RandomPage branding, and canonical `/discover?passageId=...` URL. It uses native file sharing when supported, then image clipboard, then PNG download fallback.
- Shared text includes a short excerpt, book title, author, and canonical app URL (`/discover?passageId=...`) so the exact rendered passage can be opened later instead of replacing it with a random card.
- Bookmarks has a Kindle/read-later export panel for the current saved-passage filter (all/search/tag/collection/unfiled). It downloads HTML/TXT, copies plain text, or opens an Email export action when Settings has an active read-later destination. The bundle includes passage excerpt/text, title, author, canonical RandomPage URL, tags, and private note snippets. If the generated mailto payload is too large, the client falls back to TXT download + clipboard copy.
- Bookmarks saved-passage cards expose two single-passage Markdown export options: plain Markdown and Obsidian-friendly Markdown. Both copy to clipboard first and fall back to a `.md` download; the Obsidian option adds YAML frontmatter (`title`, `author`, `sourceurl`/`randompageurl`, `tags`, `collections`, `exported_at`) before the same excerpt/private note/line-level thoughts body. This is client-local over existing user-owned RandomPage saved passages only: no Notion/Obsidian API integration, summaries, sync, social highlights, templating language, or new content source.
- Settings stores the signed-in user's private Kindle/read-later destination email plus active/approval toggles in existing `user_preferences` control rows (`control:read-later:*`); no new table or outbound email provider is introduced in v1.
- Book/source detail (`/source`) exposes the same download/copy/email export for the signed-in user's saved passages from that source only, preserving the page ordering and user-owned boundary.
- Discover current card + Daily Review cards, Bookmarks saved/Recall/Themed Review cards, and History browsing/push-inbox cards render reusable text Share and visual Card actions beside existing read/listen controls.
- Static regressions: `pnpm --filter @randompage/app check:share-passage`, `pnpm --filter @randompage/app check:kindle-export`, and `pnpm --filter @randompage/app check:markdown-export`.

## 数据维护脚本 (`apps/app/scripts/`)

| 脚本 | Ticket | 用途 |
|------|--------|------|
| `tag-passages.mjs` | PLANET-1173 | 用 Gemini Flash 给 `tags` 为空的 passage 批量打标 (genre/mood/topic/language) |
| `cleanup-boilerplate.mjs` | PLANET-1172 | 删除 Standard Ebooks / Project Gutenberg 版权/前言 boilerplate 行（DRY-RUN by default，`--apply` 才真删） |
| `check-source-policy.mjs` | PLANET-2101/2000 | 生产库 known protected-source 回归检查；review 后可 `--apply` 删除无用户引用违规行 |
| `check-browsing-events-policy.mjs` | PLANET-1985 | 静态回归检查 Discover / push-inbox telemetry 是否写入 `browsing_events` |
| `check-passage-length-policy.mjs` | PLANET-2037/2054 | 生产 corpus 长度 QA：p50/p90/p95/max、too-short/too-long samples、`--repair-plan` 分组 |
| `check-passage-content-policy.mjs` | PLANET-2139/2227/2522/2948 | 生产 corpus reference-note/footnote/chapter-list/truncated-ending QA：count + samples by reason（含 `For …, see note …` cross-reference starts、TOC/chapter lists 与 non-terminal endings）；`--apply` 只删除无 bookmarks/push_history/browsing_events/passage_reviews 引用的 unreadable rows，保留已投递/收藏的用户归属记录 |
| `check-tag-failure-policy.mjs` | PLANET-2263/3240 | 生产 corpus tag QA：报告 untagged / untagged_exhausted / failure_rows / exhausted_failure_rows 与样例，并有 `--static-only` guard 验证 Gemini quota fallback、fallbackTagged observability、Discover/daily queue tagged-pool preference，防止 retry 耗尽或 provider billing 后静默滞留 |
| `check-preferences-goals-policy.mjs` | PLANET-2418 | 静态回归检查 Settings reading goals UI 与 `POST /api/preferences/goals` seed 写入路径 |
| `check-avoid-tags-policy.mjs` | PLANET-2594 | 静态回归检查 Settings “Avoid for now”、`POST /api/preferences/avoid-tags`、Discover/daily queue/push soft down-rank 路径 |
| `check-offline-cache-policy.mjs` | PLANET-2456 | 静态回归检查 service worker navigation/static cache、Bookmarks/History 离线缓存读写与 Discover offline message |
| `check-share-passage-policy.mjs` | PLANET-2685/2748 | 静态回归检查 Web Share / clipboard fallback、client-side PNG visual card export、Discover/Bookmarks/History passage Share/Card actions |
| `check-reading-path-policy.mjs` | PLANET-2739 | 静态回归检查 `/api/reading-path`、`reading_paths` 与 Discover 7-day goal-based existing-passage path UI |
| `check-history-day-grouping-policy.mjs` | PLANET-2844 | 静态回归检查 History tab 按本地日期 Today/Yesterday/YYYY-MM-DD 分组，并保持 search/tag/offline 行为 |
| `check-passage-feedback-policy.mjs` | PLANET-2934 | 静态回归检查 Discover + Push inbox feedback chips、`POST /api/passages/:id/feedback`、bounded preference updates 与 double-submit guard。 |
| `check-kindle-export-policy.mjs` | PLANET-2984/2994 | 静态回归检查 Settings read-later destination、Bookmarks + source detail Kindle/read-later HTML/TXT/copy/email export、canonical URLs、private note snippets、no-summary boundary。 |
| `check-markdown-export-policy.mjs` | PLANET-3329/3345 | 静态回归检查 Bookmarks 单条 saved passage plain Markdown + Obsidian YAML frontmatter export、clipboard-first + `.md` fallback、excerpt/title/author/canonical URL/tags/collections/private note/line-level thoughts、no-summary/no-integration boundary。 |
| `check-recall-search-policy.ts` | PLANET-3071 | 验证 deterministic fuzzy recall scorer：approximate idea query ranks the intended saved passage above unrelated passages and private notes/tags contribute to score. |
| `check-related-saved-pages-policy.ts` | PLANET-3205 | 验证 review-card related saved pages seed from owned bookmark signals, exclude current passage, preserve bookmarkId, and rank deterministic saved matches. |
| `check-passage-annotations-policy.mjs` | PLANET-3093 | 静态回归检查 passage_annotations inline DDL、owned bookmark/user-scoped edit/delete、offset/quote validation、quote/note caps、Bookmarks selection UI 与 recall-search indexing。 |
| `check-active-recall-policy.mjs` | PLANET-3146 | 静态回归检查 active-recall cloze card inline DDL、owned bookmark scope、quote offset validation、hidden-before-reveal UI、remembered/forgot interval direction、original passage actions。 |
| `check-review-tuning-policy.mjs` | PLANET-3130 | 静态回归检查 review tuning control rows、Daily Review tuned ranking/explanations、Themed Review filtering。 |
| `check-daily-queue-policy.mjs` | PLANET-2780 | 静态回归检查 daily queue unread-exhausted fallback、API emptyReason/counts 与 Discover retry/precise empty state |
| `check-schema-table-mapping.mjs` | PLANET-1914 | 生成 production-shaped snake_case SQLite fixture，验证 Prisma `User`→`users`、`push_subscriptions`、`browsing_events`、`user_preferences` 写入路径 |
| `search-source-candidates.mjs` | PLANET-1964 | Metadata-first Open Library + Google Books candidate search; emits title/author/source_url/access_depth without caching protected text |
| `ia-ocr-pilot.mjs` | PLANET-2502 | Small Internet Archive OCR/plaintext fetchability pilot; serially downloads `_djvu.txt` candidates, slices to 180–800 char passages, writes local report/samples only |
| `ia-ocr-ingest.mjs` | PLANET-2508 | Reviewed tiny-batch IA OCR ingestion path; dry-run report by default, `--apply --ack-reviewed` required for Turso inserts with `tags='[]'` |
| `page-photo-ocr-eval.mjs` | PLANET-2708 | Local single-image Tesseract OCR evaluation for user-provided physical book pages; outputs private/import-candidate passage samples and report, no production writes |
| `openlibrary-search-inside-eval.mjs` | PLANET-3169 | Local Open Library Search Inside + IA OCR/plaintext fetchability evaluation; queries preference topics, records Read API availability, emits JSON/Markdown report with reviewed open direct-text passage candidates only, no production writes |
| `hathitrust-page-access-eval.mjs` | PLANET-3364 | Local HathiTrust Bibliographic API + page OCR access evaluation; probes Exis-aligned candidate volumes, records HTID/access flags/OCR response status, emits JSON/Markdown verdict and local passage candidates only when page text is obtainable, no production writes |
| `openlibrary-ia-candidate-queue.mjs` | PLANET-3180 | Builds a metadata-only reviewed candidate queue from the Search Inside eval artifact; emits queue/report plus `openlibrary-ia-reviewed-items.json` with rows defaulting to `reviewed:false`; no OCR/plaintext fetch before human allowlist |
| `check-openlibrary-ia-queue-policy.mjs` | PLANET-3180 | Static guard for the Open Library → IA OCR queue boundary: no network fetch in queue builder, no copied full passage text, package scripts present, and `ia-ocr-ingest` still gated by reviewed apply ack |
| `import-epub.mjs` | PLANET-1965 | Local EPUB dry-run/apply pipeline; refuses full-text import unless `--license public-domain|cc0|cc-by|permission` is supplied |

两个脚本都从 env 读 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`；`tag-passages` 还需要 `GEMINI_API_KEY`（fallback `GEMINI_API_KEY_IMAGE_GENERATION_ONLY`）。详见 `apps/app/scripts/README.md`。

下次重新 ingest 后必须按顺序跑：`cleanup-boilerplate.mjs --apply` → `tag-passages.mjs`。

## 版本记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-07-03 | PLANET-3383: Bookmarks collections now support an optional private purpose/context field for saved-passage packs. The purpose is shown near collection cards, can be edited/cleared with the collection, is stored on `bookmark_collections.purpose`, and deterministic Recall Search indexes it as a distinct `collection purpose` match reason without public sharing, external LLMs, or new content sources; added `check:collection-purpose`. | Engineer Pod |
| 2026-07-02 | PLANET-3364: Added local HathiTrust OCR/page-access passage-source evaluation (`pnpm --filter @randompage/app eval:hathitrust-page-access`) that uses HathiTrust Bibliographic API metadata/access flags, probes bounded page OCR endpoints for 10–20 Exis-aligned candidate volumes, and emits JSON/Markdown verdict/counts without Turso or production writes. | Engineer Pod |
| 2026-07-01 | PLANET-3345: Split single saved-passage Markdown export into plain Markdown plus an Obsidian-friendly Markdown option. The Obsidian option adds YAML frontmatter with title, author, sourceurl/randompageurl, tags, collections, and exported_at, then preserves the existing excerpt/private note/line-level thoughts body. Expanded `check:markdown-export`. | Engineer Pod |
| 2026-07-01 | PLANET-3329: Added single saved-passage Markdown export on Bookmarks cards for Obsidian/Notion-style vaults. Export copies Markdown first and falls back to `.md` download, preserving saved excerpt, title/author/chapter, canonical RandomPage URL, tags, collection names, bookmark private note, and line-level private thoughts/annotations without external integrations, summaries, sync, social highlights, or new content sources. Added `check:markdown-export`. | Engineer Pod |
| 2026-06-30 | PLANET-3275: Added best-effort browser Media Session metadata and lock-screen action handlers for active passage Listen controls and Discover daily listening queue. Metadata follows the active existing RandomPage passage title/author, play/pause/stop/previous/next reuse existing Web Speech queue controls where supported, and `check:listen-control` now guards the integration without adding native CarPlay/Android Auto, generated audio, summaries, or new content sources. | Engineer Pod |
| 2026-06-30 | PLANET-3295: Made offline cached-passage listening an explicit supported path. Bookmarks/History offline banners now tell users cached saved/queued/history/push-inbox cards can still use browser Web Speech with no downloaded audio, Discover offline copy points fresh recommendations back to cached Bookmarks/History listening, and `check:offline-cache` guards the copy + offline ListenControl notice. | Engineer Pod |
| 2026-06-28 | PLANET-3240: Hardened tag cron against depleted Gemini credits and low-quality tag responses. `tag-untagged` now detects Gemini credit/quota/billing 429 or too-few-tags rows, applies deterministic local fallback tags with `fallbackTagged` observability, clears recovered failure rows, and Discover/daily queue default to tagged readable pools unless `allowUntagged=1` or no tagged fallback exists; expanded `check:tag-failures --static-only`. | Engineer Pod |
| 2026-06-28 | PLANET-3205: Added “Related saved pages” to Daily Review, Themed Review, and Recall Cards. The new `/api/bookmarks/:id/related` endpoint reuses deterministic recall-search scoring over user-owned saved RandomPage passages only, excludes the current card, returns match reasons/snippets, and keeps existing open/listen/share/card/queue/review actions; added `check:related-saved-pages`. | Engineer Pod |
| 2026-06-27 | PLANET-3180: Added reviewed Open Library → IA OCR candidate queue (`pnpm --filter @randompage/app queue:ol-ia-candidates`) that converts the Search Inside eval artifact into metadata-only queue/review files, keeps all rows `reviewed:false` by default, and adds `check:ol-ia-queue` to guard against OCR/plaintext fetch or copied full passage text before human allowlist. | Engineer Pod |
| 2026-06-26 | PLANET-3169: Added local Open Library Search Inside passage-source evaluation (`pnpm --filter @randompage/app eval:ol-search-inside`) that queries five preference topics, records OLID/IA identifiers + Read API availability, attempts direct IA OCR/plaintext fetches for openly readable identifiers, and emits JSON/Markdown reports with RandomPage-style candidate passages without production writes. | Engineer Pod |
| 2026-06-25 | PLANET-3146: Added private Active Recall Mastery cloze cards over saved RandomPage passages. Users can select an exact phrase in Bookmarks, create a private card linked to that bookmark/passage, practice with the phrase hidden in context, reveal the source, grade remembered/forgot/soon/later/someday, and schedule the next due date with bounded spaced-review direction. Added `check:active-recall`. | Engineer Pod |
| 2026-06-25 | PLANET-3130: Added private Daily Review frequency tuning for global saved pages, book/source, and tag/topic scopes with pause/less/normal/more presets stored in `user_preferences` control rows; Daily Review excludes/ranks due saved passages by tuning and Bookmarks Themed Review applies the same controls. Added `check:review-tuning`. | Engineer Pod |
| 2026-06-24 | PLANET-3106: Removed the stale hard-coded production passage count from the Turso table topology; current corpus size should be verified with `pnpm --filter @randompage/app check:passage-content` (746 on 2026-06-24) instead of copied into architecture diagrams. | Engineer Pod |
| 2026-06-23 | PLANET-3071: Added Bookmarks “Recall search / Find by idea” fuzzy retrieval over the signed-in user’s own bookmarks, private notes, collection names, browsing history, and push inbox; results show match reasons/snippets and reuse open/listen/share/card/queue/save actions without external LLMs, embeddings, summaries, or new content sources. Added `check:recall-search`. | Engineer Pod |
| 2026-06-22 | PLANET-3046: Daily Review / Themed Review / Recall Cards now surface next-review interval feedback from the actual `POST /api/daily-review/:bookmarkId` response (`dueAfter`/`box`/`intervalDays`), making the PLANET-3015 spaced-repetition value visible without new endpoints, schema, summaries, feeds, or content sources. | Engineer Pod |
| 2026-06-21 | PLANET-2994: Added saved-passage Email export delivery fallback. Settings stores a private Kindle/read-later destination email with active/approval toggles in existing `user_preferences` control rows; Bookmarks and source detail show Email export when active, opening a mailto bundle or falling back to TXT download + clipboard for large saved-passage bundles; `check:kindle-export` now guards the email path. | Engineer Pod |
| 2026-06-20 | PLANET-2984: Added saved-passage Kindle/read-later export. Bookmarks can export the current filtered saved passage set as HTML/TXT/copy with title/author/excerpt/canonical URL/tags/private notes; source detail can export the signed-in user's saved passages from that source only, with `/api/book-source` returning note snippets for saved rows and `check:kindle-export` guarding the boundary. | Engineer Pod |
| 2026-06-19 | PLANET-2948: Hardened `check-passage-content-policy.mjs` with referenced/unreferenced accounting plus `--apply` cleanup; production cleanup removed 190 unreferenced unreadable passage rows, leaving the documented 39 non-terminal rows that are already user-owned via push_history/bookmarks. | Engineer Pod |
| 2026-06-18 | PLANET-2934: Added explicit passage feedback chips on Discover and History/Push inbox cards plus `POST /api/passages/:id/feedback`; signed-in taps record chip-specific `browsing_events` and update bounded tag weights for More/Less/Different-topic while Too dense records signal only; added `check:passage-feedback`. | Engineer Pod |
| 2026-06-18 | PLANET-2904: Added user-configurable daily passage delivery time in Settings; schedule persists in `user_preferences` control rows, push send/cron respect each user’s local hour by default, and QA can use `override_schedule=1`/`x-push-override-schedule: 1` to smoke-test outside the window while preserving per-user push_history. | Engineer Pod |
| 2026-06-17 | PLANET-2874: Added book/source detail deep links (`/source?title=...&author=...`) reachable from passage title/author metadata across Discover/Today, Bookmarks, and History/Push inbox surfaces; new `/api/book-source` lists existing readable RandomPage passages from the same book, with signed-in unread-first ordering plus saved/read flags and existing save/listen/share/card/queue actions. | Engineer Pod |
| 2026-06-16 | PLANET-2844: History tab now renders the current browsing or push-inbox results as a local-day timeline (Today, Yesterday, then YYYY-MM-DD), keeps existing search/tag/offline states, and uses push `readAt` before `sentAt` for read deliveries; added `check:history-day-grouping`. | Engineer Pod |
| 2026-06-15 | PLANET-2816: Added user-curated “My Queue” passage playlist; Discover and Bookmarks can add existing passages to a device-local ordered queue, Bookmarks shows queued passages with Listen/Share/Card controls plus remove/clear actions, and `check:reading-queue` guards the MVP. | Engineer Pod |
| 2026-06-14 | PLANET-2795: Added lightweight reading challenges on Discover plus `GET /api/reading/challenges`; progress is derived from existing browsing/review/path/push/preference tables for Daily 3 pages, Weekly saved review, 7-day path progress, Open pushed page, and Explore favorite topic; added `check:reading-challenges` with no social/course/monetization layer. | Engineer Pod |
| 2026-06-14 | PLANET-2780: Hardened `/api/passages/daily-queue` so signed-in readers get 3–5 existing readable RandomPage passages when possible: unread/avoid-free first, then unread, then read-but-not-recent fallback, then any readable fallback; API now returns fallback/emptyReason/count metadata and Discover shows precise retryable empty states instead of generic sign-in-sync copy; added `check:daily-queue`. | Engineer Pod |
| 2026-06-13 | PLANET-2764: Added hands-free daily listening queue on Discover Today’s fresh pages; signed-in users can start browser speech playback across the personalized 3–5 existing passages with pause/resume/next/stop, active passage highlighting, and existing Discover view recording via `fetchPassageById(..., source=discover)`; expanded `check:listen-control`. | Engineer Pod |
| 2026-06-13 | PLANET-2748: Added client-side visual passage card export across Discover current/Daily Review, Bookmarks saved/Recall/Themed Review, and History browsing/push-inbox cards; canvas PNG contains existing passage excerpt, title/author, RandomPage branding, canonical passage URL, and shares via native file share/image clipboard/download fallback; expanded `check:share-passage`. | Engineer Pod |
| 2026-06-13 | PLANET-2739: Added 7-day goal-based reading paths in Discover; signed-in readers can start a path from existing reading goals/topics, persisted in `reading_paths` with 7 existing passage IDs, Day N/7 current card, upcoming teasers, and `check:reading-path`; no generated summaries/courses or new content sources. | Engineer Pod |
| 2026-06-12 | PLANET-2708: Added `page-photo-ocr-eval.mjs` local Tesseract prototype for one user-provided physical book page image; outputs 1–3 private/import-candidate RandomPage passage candidates with title/source metadata plus report/sample JSON; no Turso or production writes. | Engineer Pod |
| 2026-06-11 | PLANET-2685: Added reusable SharePassageButton across Discover current/Daily Review, Bookmarks saved/Recall/Themed Review, and History browsing/push-inbox cards; Web Share API opens native share where available and clipboard fallback copies excerpt/title/author/canonical passage URL; added `check:share-passage`. | Engineer Pod |
| 2026-06-10 | PLANET-2661: Saved passages 新增私密 note；`bookmarks.note` 挂在 user-bookmark relationship，Bookmarks 可 inline save/clear，Daily/Themed Review 与 Recall Cards resurfacing 时显示 note snippet；新增 `check:bookmark-notes`. | Engineer Pod |
| 2026-06-10 | PLANET-2641: Bookmarks 新增 saved-passage Recall Cards；due saved passages 先隐藏正文并提示 “What idea did this page contain?”，Reveal 后可 Remembered / Review later / Skip，继续复用 `passage_reviews`，无新表。 | Engineer Pod |
| 2026-06-09 | PLANET-2615: Added reusable Web Speech Listen controls for Discover current passages, Bookmarks saved/themed-review cards, and History browsing/push-inbox cards; v1 stays browser-only with graceful unsupported/no-voice fallback and `check:listen-control`. | Engineer Pod |
| 2026-06-08 | PLANET-2594: Settings Personalization 新增 “Avoid for now” real passage-tag controls；保存为既有 `user_preferences` 的 `avoid:<tag>` negative rows；Discover random、daily queue、push selection 对 avoided moods/topics soft down-rank/优先避开，同时保留无合适替代时的 graceful fallback；新增 `check:avoid-tags`. | Engineer Pod |
| 2026-06-07 | PLANET-2569: Bookmarks Themed Review 新增自然语言 topic 输入（如 “stoicism under stress”），在用户 saved RandomPage book passages 的 text/title/author/tags/collections 内匹配 1–5 条 due passages；Reviewed/Skip today 继续复用 `passage_reviews`，避免同一 topic 立即重复。 | Engineer Pod |
| 2026-06-07 | PLANET-2559: Bookmarks 新增 Themed Review focused queue，用户可按已保存 passage 的 tag 或 collection 选择 1–5 条 due saved passages；Reviewed/Skip today 复用既有 `passage_reviews`，避免同一主题内立即重复。 | Engineer Pod |
| 2026-06-06 | PLANET-2538: Added `/today` PWA-friendly Today shortcut surface that reads existing push_history first and falls back to `/api/passages/daily-queue`; Settings exposes add/open Today guidance and manifest shortcuts point to `/today`. | Engineer Pod |
| 2026-06-06 | PLANET-2517/2522: Push send now normalizes legacy `push_subscriptions.created_at` ISO text into INTEGER unix seconds before Prisma reads and writes new subscriptions raw; passage content policy/runtime/import checks now reject repeated table-of-contents/chapter-list fragments and report samples by reason. | Engineer Pod |
| 2026-06-05 | PLANET-2508: Added reviewed IA OCR tiny-batch ingest path (`pnpm --filter @randompage/app ingest:ia-ocr`) with explicit reviewed item list, length/content checks before rows, report/sample output, and gated `--apply --ack-reviewed` Turso insert mode. | Engineer Pod |
| 2026-06-04 | PLANET-2467: Discover/Daily Queue/History/Push inbox now include compact “Why this page?” explanations derived from existing `user_preferences` × passage tags, with graceful no-claim fallback for anonymous/no-preference users; added `check:recommendation-explanations`. | Engineer Pod |
| 2026-06-05 | PLANET-2502: Added Internet Archive OCR fetch-to-passages pilot (`pnpm --filter @randompage/app pilot:ia-ocr -- --limit 10`) plus report/samples under `apps/app/docs`; pilot passed 10/10 items and 2315 candidate passages without production ingest. | Engineer Pod |
| 2026-06-04 | PLANET-2456: PWA offline access for saved passages and push inbox — service worker caches app shell/static assets; Bookmarks/History cache last online saved/history responses in localStorage and render read-only offline banners; Discover shows graceful offline network-required message; added `check:offline-cache`. | Engineer Pod |
| 2026-06-03 | PLANET-2418: Settings 新增移动优先 “Personalization / Reading goals” card；`GET /api/preferences` 返回 goal presets + 当前权重，`POST /api/preferences/goals` 将 1–3 个 preset 映射到既有 `user_preferences` tag 权重（seed weight=7），Discover/daily queue 继续复用现有个性化采样。 | Engineer Pod |
| 2026-06-02 | PLANET-2370: Discover 新增 “Daily Review” saved-passage revisit card；后端新增 `GET /api/daily-review` 返回 1–3 条 due bookmarked passages，`POST /api/daily-review/:bookmarkId` 持久化 reviewed/skip 并写入 `passage_reviews.due_after`，无 bookmarks 时不显示空态。 | Engineer Pod |
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
