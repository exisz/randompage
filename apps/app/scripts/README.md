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
