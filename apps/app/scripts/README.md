# scripts/

Database maintenance scripts for the RandomPage Turso DB.

Most production DB scripts read `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from
the environment (see `apps/app/.env.example`). Evaluation-only pilots are marked
separately and do not write production data.

## ia-ocr-pilot.mjs — PLANET-2502

Small Internet Archive OCR fetch-to-passages pilot. It selects 10 IA text items
across philosophy, psychology, history, literature, and essays; downloads the
best `_djvu.txt`/OCR plaintext file; cleans obvious OCR/page boilerplate; slices
with RandomPage's existing passage bounds (target ≈300 chars, accepted 180–800
chars); and writes a markdown report plus JSON samples.

```bash
pnpm --filter @randompage/app pilot:ia-ocr -- --limit 10
pnpm --filter @randompage/app pilot:ia-ocr -- --ids item1,item2 --refresh
```

Outputs:
- `apps/app/docs/ia-ocr-pilot-report.md`
- `apps/app/docs/ia-ocr-pilot-samples.json`
- transient cache under `apps/app/.cache/ia-ocr-pilot/` (gitignored)

Safety/rate limits:
- Serial requests only, descriptive User-Agent, short delay between downloads.
- Retries only for 429/5xx.
- No Turso inserts and no high-volume crawling.

## ia-ocr-ingest.mjs — PLANET-2508

Guarded tiny-batch ingestion path for reviewed Internet Archive OCR/plaintext
items. Dry-run is default. The script reads an explicit reviewed item list,
serially fetches each item’s IA metadata and reviewed `.txt` file, reuses the
IA OCR cleaner/slicer, applies RandomPage passage length/content policy checks,
and writes a markdown report plus JSON samples. Candidate rows use `tags='[]'`
so the existing tag cron can classify them later.

```bash
pnpm --filter @randompage/app ingest:ia-ocr -- --max-items 2 --max-passages-per-item 10
pnpm --filter @randompage/app ingest:ia-ocr -- --reviewed docs/ia-ocr-reviewed-items.json --json
```

Outputs:
- `apps/app/docs/ia-ocr-ingest-report.md`
- `apps/app/docs/ia-ocr-ingest-samples.json`

Apply is intentionally gated:

```bash
pnpm --filter @randompage/app ingest:ia-ocr -- --apply --ack-reviewed --max-items 1 --max-passages-per-item 5
```

Apply requires `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from env or
`apps/app/.env.local`. It blocks unless `--ack-reviewed` is supplied, skips
already-present book titles/duplicate row ids, persists item-level failures in
the report, and never performs broad search/crawling.

Safety/rate limits:
- Reviewed item list only; no broad crawler/search behavior.
- Serial requests, descriptive User-Agent, 750ms inter-item delay.
- Retries only for 429/5xx with short backoff.
- Passage checks reject out-of-bounds rows, standalone reference/footnote
  fragments, non-terminal endings, and low-letter-ratio OCR noise before insert.

## page-photo-ocr-eval.mjs — PLANET-2708

Local evaluation prototype for one user-provided physical book page photo. It
runs the local Tesseract CLI against a single image, cleans OCR text, slices it
into 1–3 RandomPage-sized passage candidates, attaches user-supplied
book/title/source metadata, and writes report/sample JSON files. It never writes
to Turso or production tables; candidates are marked `private/import-candidate`.

```bash
pnpm --filter @randompage/app eval:page-ocr -- \
  --image /path/to/clear-book-page.jpg \
  --title "Meditations" \
  --author "Marcus Aurelius" \
  --source "user-provided page photo"
```

Outputs:
- `apps/app/docs/page-photo-ocr-eval-report.md`
- `apps/app/docs/page-photo-ocr-eval-samples.json`

Notes:
- Requires the `tesseract` binary on the developer machine; pass
  `--tesseract /path/to/tesseract` if it is not on PATH.
- This is an evaluation path, not a production camera/import feature. A product
  version still needs a signed-in UI, explicit user confirmation, and private
  save/import handling.

## openlibrary-search-inside-eval.mjs — PLANET-3169

Local evaluation for Open Library Search Inside plus Internet Archive readable
OCR/plaintext fetchability. It queries RandomPage preference topics, records
OLID/IA identifiers and Read API availability, then attempts small serial direct
text fetches only for openly readable IA identifiers. It writes a Markdown
verdict and JSON sample candidates; it never writes Turso or imports production
passages.

```bash
pnpm --filter @randompage/app eval:ol-search-inside -- \
  --per-topic 20 \
  --max-text-fetches 40 \
  --max-candidates 20
```

Outputs:
- `apps/app/docs/openlibrary-search-inside-eval-report.md`
- `apps/app/docs/openlibrary-search-inside-eval-samples.json`

Safety/rate limits:
- Serial requests only, descriptive User-Agent, short delays between calls.
- Search Inside snippets are discovery evidence; production passage import must
  use a reviewed allowlist and the existing IA OCR/content-policy checks.
- No protected full-text caching, summaries, generic reader/feed scope, or
  production writes.

## tag-passages.mjs — PLANET-1173

Backfill `tags` for any passage where `tags IS NULL OR '' OR '[]'`.
Uses Gemini Flash (`GEMINI_API_KEY`, falls back to
`GEMINI_API_KEY_IMAGE_GENERATION_ONLY`) to produce 4–7 normalized tags per
passage covering genre, mood, topic, language (+ optional difficulty).

```bash
pnpm node scripts/tag-passages.mjs --dry-run            # preview
pnpm node scripts/tag-passages.mjs                      # tag everything empty
pnpm node scripts/tag-passages.mjs --limit 50 --batch 8 # cap batch
```

Idempotent — safe to re-run; only touches rows where `tags` is empty.

## cleanup-boilerplate.mjs — PLANET-1172

Remove Standard Ebooks / Project Gutenberg meta-text passages (volunteer
notices, copyright disclaimers, "first edition" notices, lone "Translated by"
lines, etc.) that slipped past the ingest cleanup step.

```bash
pnpm node scripts/cleanup-boilerplate.mjs               # DRY RUN (default)
pnpm node scripts/cleanup-boilerplate.mjs --apply       # actually delete
pnpm node scripts/cleanup-boilerplate.mjs --apply --force-refs  # also drop push_history rows
```

Safety:
- Never deletes a row that has a `bookmarks` row pointing at it (would corrupt a
  user's library) — those are reported and skipped for manual review.
- Rows with `push_history` entries are skipped unless `--force-refs` is passed,
  in which case the matching history rows are cascade-deleted first.

## Adding new boilerplate patterns

Update `classify()` in `cleanup-boilerplate.mjs`. The SQL pre-filter
(`CANDIDATE_SQL`) only narrows the candidate set; the in-memory classifier is
the final gate, so adding a new pattern usually means editing both: extend the
`LIKE` list to include candidates, then add a matching `if (lower.includes…)`
clause that returns a human-readable reason string.

## check-source-policy.mjs — PLANET-2101 / PLANET-2000

Narrow regression smoke for known protected/modern-book full-text sources that
must not reappear in the passage cache. This is a deny-list safety guard, not the
primary source strategy.

```bash
pnpm check:source-policy
pnpm check:source-policy -- --json
pnpm check:source-policy -- --apply   # reviewed cleanup only; refuses user refs
```

Reads production Turso env from `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` or
`apps/app/.env.local` and currently checks the known PLANET-2000 Colleen Hoover /
*It Ends With Us* source. `--apply` only deletes unreferenced violations after
manual review.

## search-source-candidates.mjs — PLANET-1964

Metadata-first source adapter POC for Open Library + Google Books. It returns
book candidates and access-depth labels without caching protected text.

```bash
pnpm node scripts/search-source-candidates.mjs --query "philosophy history" --limit 20
pnpm search:sources -- --query "psychology classics" --source openlibrary --limit 20
```

Output fields include `title`, `author`, `source_url`, `access_depth`, and
`allowed_full_text_fetch`. Only `public-domain-full-text` records should be sent
to a later passage-generation worker.

## import-epub.mjs — PLANET-1965

EPUB-first local import pipeline. Dry-run is default. `--apply` writes passages
only after an operator supplies an allowed license assertion. The slicer enforces
RandomPage's quick flip-reading bounds: target ≈300 chars, accepted 180–800 chars.

```bash
pnpm import:epub -- ~/Books/example.epub --license public-domain --max-passages 25
pnpm import:epub -- ~/Books/example.epub --license cc-by --apply
```

Allowed licenses: `public-domain`, `cc0`, `cc-by`, `permission`. Protected books
without a reuse license must stay metadata-only.

## check-passage-length-policy.mjs — PLANET-2037 / PLANET-2054

Corpus quality smoke for overlong/quote-sized fragments. Reads production Turso
env from `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` or `apps/app/.env.local` and
reports p50/p90/p95/max plus too-short and too-long examples.

```bash
pnpm check:passage-lengths
pnpm check:passage-lengths -- --json --sample 5
pnpm check:passage-lengths -- --repair-plan
```

Policy: target ≈300 chars, valid 180–800 chars. `--repair-plan` groups affected
books and counts user-referenced rows so a later repair can reslice sources,
insert replacement fragments, and only delete unreferenced out-of-policy rows.

## check-passage-content-policy.mjs — PLANET-2139 / PLANET-2227

Corpus quality smoke for standalone reference-note / footnote fragments and
sentence-boundary truncations. Reads production Turso env from
`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` or `apps/app/.env.local` and reports
count + samples for leading `↩`, note headings, editorial-note starts, note
cross-reference starts such as `For …, see note …`, dense reference-marker
clusters, and passages ending without sentence-terminal punctuation.

```bash
pnpm check:passage-content
pnpm check:passage-content -- --json --sample 5
```

These rows are excluded by runtime Discover/push filtering and by future import
slicing; destructive cleanup still needs a separate reviewed repair run if rows
have user references.

## Tag failure QA

```bash
pnpm check:tag-failures
pnpm check:tag-failures -- --json --sample 5
pnpm check:tag-failures -- --fail-on-exhausted
```

Reports production `untagged`, `untagged_exhausted`, `failure_rows`, and `exhausted_failure_rows` counts so tag cron retries cannot silently strand passages after partial LLM failures.
