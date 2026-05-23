# ADR: RandomPage 10M-book source adapter (content acquisition)

Status: superseded by 2026-05-23 owner direction change (kept for historical context)  
Tickets: PLANET-1964, PLANET-1965, PLANET-1966  
Date: 2026-05-22 (updated 2026-05-23)

## 2026-05-23 Direction update (read first)

Owner changed direction: RandomPage should stop framing source work around source-safety / license tiers / protected-full-text avoidance. The product question is now:

> Can we fetch book content from a source, slice it into ~300-word passages, tag it, and show it in Discover / push?

This ADR’s historical tables below describe the metadata-first POC built for PLANET-1964 and the access-depth labels that the import script + Telegram handoff currently emit. They are accurate as runtime behavior, but **Pods should no longer treat license tier as the primary acceptance axis** for new source/content-acquisition tickets. Acceptance for new work is end-to-end: a configured source produces N usable passages in production and they appear in Discover or push.

## Context (historical)

RandomPage wants a much larger book discovery universe. The original POC scoped a metadata-first adapter across Open Library, Google Books, and OAIster/WorldCat discovery, with full-text acquisition limited to verified-permissible items.

## Sources and intended use (historical reference)

| Source | Intended use | Cached fields the POC keeps |
| --- | --- | --- |
| Open Library | Bulk metadata discovery from dumps; low-volume lookup/search for UI or scripts | work/edition IDs, title, author names, subjects, language, first publish year, cover IDs, public scan/access flags, canonical Open Library URLs |
| Google Books API | Enrich candidate metadata and link users to previews/readers | volume ID, title, authors, publisher/date, categories, language, `accessInfo`/viewability flags, preview/info/web reader links, boolean snippet availability |
| OAIster/WorldCat | Open-access discovery and linkout | title/creator/provider metadata, WorldCat/OA landing URLs, access notes when available |

## Access depth labels (still emitted by current scripts)

The POC scripts and handoff APIs still emit these labels in their output for observability. They are not new acceptance gates:

- `metadata-only` — title/author/linkout only; no snippets or text cached.
- `snippet-only` — upstream API exposed a short snippet/preview.
- `preview-link` — user is linked to an external reader; no text cached.
- `public-domain-full-text` — full text fetched and sliced.
- `user-supplied-licensed-epub` — full text from a user-provided EPUB.

## Rate-limit and backend strategy (still applies)

- Prefer Open Library monthly dumps for bulk metadata. Use Open Library APIs only for low-volume lookup, enrichment, and POC scripts.
- Use Google Books API with small `maxResults`, bounded pagination, exponential backoff on 429/5xx, and optional API key via `GOOGLE_BOOKS_API_KEY`.
- Treat OAIster primarily as a discovery/linkout surface unless an authenticated WorldCat/OCLC API integration is explicitly provisioned.
- Every network adapter must send a clear user-agent where the upstream accepts one.
- Production jobs must persist cursor/checkpoint state before each irreversible ingest step.

## Attribution and linkout (still applies)

Each candidate book record retains:

- `source` and stable source ID/key.
- `source_url` for human verification/linkout.
- access flags that led to the access-depth decision.
- optional `rights_note` field for operator annotations.

## Telegram EPUB handoff guardrail (still applies as an intake envelope)

The Telegram handoff endpoint is an intake envelope. It accepts metadata and a Telegram file reference (no raw text or base64 payload through JSON) and returns whether a later worker may process the file.

## POC artifacts

- `apps/app/scripts/search-source-candidates.mjs` searches Open Library and Google Books and emits at least 20 candidate records.
- `apps/app/scripts/import-epub.mjs` parses a local EPUB into dry-run passage candidates.
- `POST /api/import/telegram-epub-handoff` accepts a secret-protected metadata envelope and returns a routing decision.

## References

- Open Library API and bulk data docs: https://openlibrary.org/developers/api and https://openlibrary.org/data
- Google Books API Volumes docs: https://developers.google.com/books/docs/v1/reference/volumes
- OAIster access docs: https://www.oclc.org/en/oaister/access.html
