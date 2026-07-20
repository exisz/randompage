# Library of Congress Selected Digitized Books eval — PLANET-3874

Generated: 2026-07-20T06:18:34.202Z

## Boundary

- Local evaluation only; no Turso writes, no production ingest, no LLM tagging, no summaries.
- Candidate snippets are existing OCR book text and are emitted only as local review artifacts.
- Product boundary remains RandomPage book passages + user-owned delivery/history, not a full reader or social/book-review app.

## Source access notes

- Manifest: https://data.labs.loc.gov/digitized-books/manifest.txt
- Fetch mode: bulk manifest.txt discovery + per-file direct .txt download from LOC Labs data package.
- This validates the dataset as bulk-package discovery plus per-file text fetch, not a loc.gov search crawl.
- A real pipeline should keep this as reviewed/import-gated and should reuse existing passage length/content policy checks before Turso writes.

## Scorecard

- Manifest .txt rows inspected: 80
- Sampled text files: 3
- Text fetch successes: 3/3
- Sampled download size: 301 KiB
- Candidate snippets found: 328
- Avg candidate snippets / successful text file: 109.3
- Rough package-wide candidate estimate: ~9,187,539 snippets (simple avg × 84,058 text files; rough only).
- Verdict: A: promising as a direct reviewed passage source; build a gated ingest follow-up

## Sampled items

| File | LOC item | Title | Author | Size | Candidates | Status |
|---|---|---|---:|---:|---:|---|
| 00000177.txt | http://www.loc.gov/item/00000177/ | Our country in poem and prose; arranged and for collateral supplementary reading, | Persons, Eleanor Alice. [from old catalog] | 230 KiB | 288 | ok |
| 00000433.txt | http://www.loc.gov/item/00000433/ | The house of a hundred lights. | Torrence, Ridgely, 1875-1950. | 16 KiB | 1 | ok |
| 00000108.txt | http://www.loc.gov/item/00000108/ | Anti-Carnegie scraps and comments, | Campbell, M. F. [from old catalog] | 55 KiB | 39 | ok |

## Recommendation

Create a follow-up gated ingest ticket: read manifest rows into a reviewed queue, fetch selected `.txt` files serially, run existing readability/length/content filters, write dry-run reports by default, and require explicit `--apply --ack-reviewed` before production inserts.

