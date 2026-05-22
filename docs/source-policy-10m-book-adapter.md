# ADR: RandomPage 10M-book source adapter policy

Status: accepted for POC  
Tickets: PLANET-1964, PLANET-1965, PLANET-1966  
Date: 2026-05-22

## Context

RandomPage wants a much larger book discovery universe without becoming a copyrighted-text cache. The product should discover candidate books at metadata scale, then only turn legally fetchable full text into ~300-word passages.

This ADR covers a metadata-first adapter across Open Library, Google Books, and OAIster/WorldCat discovery.

## Sources and allowed use

| Source | Intended use | Allowed to cache | Forbidden to cache |
| --- | --- | --- | --- |
| Open Library | Bulk metadata discovery from dumps; low-volume lookup/search for UI or scripts | work/edition IDs, title, author names, subjects, language, first publish year, cover IDs, public scan/access flags, canonical Open Library URLs | copyrighted full text, borrowed scan content, API responses used as a high-volume production backend |
| Google Books API | Enrich candidate metadata and link users to previews/readers | volume ID, title, authors, publisher/date, categories, language, `accessInfo`/viewability flags, preview/info/web reader links, boolean snippet availability | cached protected page text; ACSM/download payloads; more than short API-provided snippets; private library data |
| OAIster/WorldCat | Open-access discovery and linkout | title/creator/provider metadata, WorldCat/OA landing URLs, access/license notes when available | harvested repository full text unless the landing page/license explicitly permits reuse |

## Full-text rule

RandomPage may create or cache 300-word passages only when one of these is true:

1. The item is public domain / full-view and the source terms allow download/reuse.
2. The item is CC0, CC-BY, or another license that permits the planned cache/reuse.
3. The user explicitly uploads an EPUB and asserts a permitted license or personal permission for this RandomPage instance.

Otherwise the pipeline must stay metadata-only and link out to the source.

## Access depth labels

Adapters and handoff APIs must classify every candidate:

- `metadata-only` — title/author/linkout only; no snippets or text cached.
- `snippet-only` — the upstream API exposes a short snippet/preview; RandomPage may display availability but should avoid durable text caching unless source terms explicitly allow it.
- `preview-link` — user can be linked to source preview/reader; RandomPage does not cache text.
- `public-domain-full-text` — full text can be fetched and sliced after source verification.
- `user-supplied-licensed-epub` — full text comes from a user-provided EPUB with an allowed license assertion.

## Rate-limit and backend strategy

- Prefer Open Library monthly dumps for bulk metadata. Use Open Library APIs only for low-volume lookup, enrichment, and POC scripts.
- Use Google Books API with small `maxResults`, bounded pagination, exponential backoff on 429/5xx, and optional API key via `GOOGLE_BOOKS_API_KEY`.
- Treat OAIster primarily as a discovery/linkout surface unless an authenticated WorldCat/OCLC API integration is explicitly provisioned.
- Every network adapter must send a clear user-agent where the upstream accepts one.
- Production jobs must persist cursor/checkpoint state before each irreversible ingest step.

## Attribution and linkout

Each candidate book record must retain:

- `source` and stable source ID/key.
- `source_url` for human verification/linkout.
- access/license flags that led to the access-depth decision.
- optional `rights_note` explaining why the item is, or is not, eligible for passage generation.

## Telegram EPUB handoff guardrail

Telegram handoff is only an intake envelope. It must not accept raw book text/base64 through JSON and must not auto-import protected text. The API can accept metadata and a Telegram file reference, then return whether a later worker may process the file.

Allowed handoff body fields: file id, file name, MIME type, title, author, source URL, asserted license/public-domain flag, and operator note. Forbidden fields include raw text, HTML, base64 EPUB payloads, and extracted chapter content.

## POC artifacts

- `apps/app/scripts/search-source-candidates.mjs` searches Open Library and Google Books and emits at least 20 metadata-only candidate records.
- `apps/app/scripts/import-epub.mjs` parses a local EPUB into dry-run passage candidates and requires an allowed license before `--apply` can write passages.
- `POST /api/import/telegram-epub-handoff` accepts a secret-protected metadata envelope and returns a policy decision without storing protected text.

## References

- Open Library API and bulk data docs: https://openlibrary.org/developers/api and https://openlibrary.org/data
- Google Books API Volumes docs: https://developers.google.com/books/docs/v1/reference/volumes
- OAIster access docs: https://www.oclc.org/en/oaister/access.html
