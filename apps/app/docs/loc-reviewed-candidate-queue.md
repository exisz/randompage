# LOC Selected Digitized Books reviewed candidate queue — PLANET-3882

Generated: 2026-07-20T14:23:08.984Z
Source: docs/loc-digitized-books-eval-samples.json

## Summary

- Candidate queue rows: 3
- Human-reviewed rows: 1
- Default safety posture: rows are `reviewed:false` unless explicitly marked after human review.
- This queue stores LOC metadata only. It does not fetch OCR/plaintext, copy passage text, or write production data.
- Next dry-run command after reviewing/editing `docs/loc-reviewed-items.json`:

```bash
pnpm --filter @randompage/app ingest:loc-reviewed -- --reviewed docs/loc-reviewed-items.json --max-items 1 --max-passages-per-item 10
```

Use `--apply --ack-reviewed` only for a tiny reviewed batch after inspecting dry-run artifacts.

## Queue

| # | reviewed | score | title | author | LOC filename | source |
|---:|---|---:|---|---|---|---|
| 1 | no | 59 | 00000177 | Unknown | 00000177.txt | http://www.loc.gov/item/00000177/ |
| 2 | yes | 53 | Anti-Carnegie scraps and comments, | Campbell, M. F. [from old catalog] | 00000108.txt | https://www.loc.gov/resource/gdcmassbookdig.anticarnegiescra00camp/ |
| 3 | no | 45 | The house of a hundred lights. | Torrence, Ridgely, 1875-1950. | 00000433.txt | https://www.loc.gov/resource/gdcmassbookdig.houseofhundredli00torr/ |

## Boundary

- RandomPage remains a personalized book-passage discovery engine.
- Production ingest is gated by explicit reviewed input plus apply/ack flags in the ingest script.
- No summaries, full-reader, social feed, or direct unreviewed Discover/push exposure are introduced.
