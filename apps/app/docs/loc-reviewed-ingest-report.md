# PLANET-3882 — LOC reviewed ingest report

Generated: 2026-07-20T14:23:12.598Z

## Summary

- Mode: dry-run
- Reviewed LOC files evaluated: 1
- Candidate rows accepted by policy: 3
- Expected production insert count: 3
- Rows inserted: 0
- Failures/skips: 0
- Apply blocked: no

## Candidate rows

| # | ID | Title | Author | LOC source | Chars | Preview |
|---:|---|---|---|---|---:|---|
| 1 | c78c2392ee8b25de | Anti-Carnegie scraps and comments, | Campbell, M. F. [from old catalog] | https://data.labs.loc.gov/digitized-books/data/00000108.txt | 273 | rumors of war, no work " ; later some  of his employees took up the subject  and echoed his words. Carnegie was  delight |
| 2 | 216d20dc86504d64 | Anti-Carnegie scraps and comments, | Campbell, M. F. [from old catalog] | https://data.labs.loc.gov/digitized-books/data/00000108.txt | 302 | Senator Mason that smacked of Car-  ANTI-CARNEGIE :  negie. Mason never let go his manuscript, but applied himself close |
| 3 | 805eed9d5cd41845 | Anti-Carnegie scraps and comments, | Campbell, M. F. [from old catalog] | https://data.labs.loc.gov/digitized-books/data/00000108.txt | 302 | enjoy the advantage over our opponents that we now do, having to  meet them in the open field."  Andrew Carnegie has bee |

## Item-level results

| LOC file | Status | Clean chars | Accepted | Rejected/skipped | Notes |
|---|---|---:|---:|---|---|
| 00000108.txt | ready | 53722 | 3 | {} | https://www.loc.gov/resource/gdcmassbookdig.anticarnegiescra00camp/ |

## Safety

- Reviewed list is explicit and only rows with `reviewed:true` are fetched.
- Dry-run is default and writes only local report/sample artifacts.
- Apply requires `--apply --ack-reviewed`, Turso credentials, and rows that pass RandomPage length/content policies.
- Inserted rows use `tags=[]`; existing tag cron handles later tagging.
- No summaries, full-reader, social layer, or unreviewed Discover/push exposure are introduced.
