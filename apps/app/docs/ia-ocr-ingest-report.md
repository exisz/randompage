# PLANET-2508 — IA OCR small-batch ingestion report

Generated: 2026-06-05T06:27:40.771Z

## Summary

- Mode: dry-run
- Reviewed items evaluated: 1
- Candidate rows accepted by policy: 3
- Rows inserted: 0
- Failures/skips: 0
- Apply blocked: no

## Candidate rows

| # | ID | Title | Author | Source URL | Chars | Preview |
|---:|---|---|---|---|---:|---|
| 1 | 46e0554e5e26b612 | Understanding human nature | Alfred Adler | https://archive.org/download/understandinghum00adlerich/understandinghum00adlerich_djvu.txt | 268 | were more satisfactory. Disturbing social relationships  could then be obviated, for we know that unfortunate adjustment |
| 2 | 562049c76bbdf5f8 | Understanding human nature | Alfred Adler | https://archive.org/download/understandinghum00adlerich/understandinghum00adlerich_djvu.txt | 199 | what great misfortunes follow decades after a misinterpretation of a fellow man. Such dismal occurrences teach us  the n |
| 3 | ebb5e0bba384d837 | Understanding human nature | Alfred Adler | https://archive.org/download/understandinghum00adlerich/understandinghum00adlerich_djvu.txt | 338 | greater part of our investigation to the childhood of all  patients; and thus we developed the art of being able,  often |

## Item-level results

| Identifier | Status | Clean chars | Accepted | Rejected/skipped | Notes |
|---|---|---:|---:|---|---|
| understandinghum00adlerich | ready | 519716 | 3 | {} | understandinghum00adlerich_djvu.txt |

## Safety

- Reviewed item list is explicit; no broad crawler/search is used.
- Requests are serial with a descriptive User-Agent and small retry/backoff only for 429/5xx.
- Passage rows must pass RandomPage bounds (180–800 chars), sentence-terminal ending, reference-note/footnote rejection, and letter-ratio checks before insert.
- Inserted rows use `tags=[]`; existing tag cron handles later tagging.
