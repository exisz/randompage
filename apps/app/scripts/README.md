# scripts/

Database maintenance scripts for the RandomPage Turso DB.

Both scripts read `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from the
environment (see `apps/app/.env.example`).

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

## check-passage-content-policy.mjs — PLANET-2139

Corpus quality smoke for standalone reference-note / footnote fragments. Reads
production Turso env from `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` or
`apps/app/.env.local` and reports count + samples for leading `↩`, note headings,
editorial-note starts, and dense reference-marker clusters.

```bash
pnpm check:passage-content
pnpm check:passage-content -- --json --sample 5
```

These rows are excluded by runtime Discover/push filtering and by future import
slicing; destructive cleanup still needs a separate reviewed repair run if rows
have user references.
