# RandomPage ingest launchd job (PLANET-1991)

Local cron for the rank → fetch → slice → Turso pipeline. Runs on the Mac mini
because `bookworm` CLI needs a Telegram user session and writes to
`/Volumes/4t/bookworm/` — neither is reachable from Vercel functions.

## Install

```bash
cp com.randompage.ingest-hot-books.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.randompage.ingest-hot-books.plist
launchctl list | grep randompage    # confirm loaded
tail -f ~/Library/Logs/randompage-ingest.log
```

## Schedule

Daily at 03:00 local time. `RunAtLoad=false` — it will not fire on load.

## Manual trigger (for testing)

```bash
launchctl start com.randompage.ingest-hot-books
```

## Unload

```bash
launchctl unload ~/Library/LaunchAgents/com.randompage.ingest-hot-books.plist
```

## Tuning

Edit the `ProgramArguments` block to change flags:

- `--limit N` — number of unique new books to attempt (default 10)
- `--lang en,zh` — comma-separated languages
- `--max-passages N` — total passage cap per run (default 50)
- `--max-per-book N` — passages per book cap (default 10)
- `--dry-run` — no DB writes; prints plan JSON to stdout

## Dependencies

- `bookworm` CLI on PATH with valid `~/.bookworm/bookworm.session`
- `/Volumes/4t/bookworm/` writable
- `apps/app/.env.local` containing `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
  (use `vercel env pull --environment=production .env.local` inside `apps/app`)
