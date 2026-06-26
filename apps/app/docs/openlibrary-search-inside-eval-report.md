# Open Library Search Inside passage-source pilot — PLANET-3169

Generated: 2026-06-26T02:21:18.165Z

## Verdict

**A: viable as a reviewed direct passage source for open IA OCR items**

Open Library Search Inside is useful as a high-coverage discovery surface: it returns topic-matched snippets, OL edition links, IA identifiers, and Read API availability signals for RandomPage preference topics. For production RandomPage passages, the safest smallest path is not blind import from Search Inside snippets; it is a reviewed pipeline that keeps Search Inside as discovery/ranking, then fetches direct IA OCR/plaintext only for openly readable identifiers and runs the existing passage cleaning policy before any tiny import.

## Counts

- queries run: 5 (philosophy, psychology, history, literature, classics)
- records returned: 100
- records with snippets: 100
- readable/full-access Read API links found: 23
- open direct-text candidates: 23
- direct IA text/OCR fetch successes: 20
- direct IA text/OCR fetch failures: 0
- usable RandomPage-style passage candidates emitted: 20

| topic | records | snippet rows | readable links | open direct candidates | usable passages |
|---|---:|---:|---:|---:|---:|
| philosophy | 20 | 20 | 8 | 8 | 8 |
| psychology | 20 | 20 | 2 | 2 | 2 |
| history | 20 | 20 | 4 | 4 | 4 |
| literature | 20 | 20 | 3 | 3 | 3 |
| classics | 20 | 20 | 6 | 6 | 3 |

## Source scoring

| dimension | score | note |
|---|---:|---|
| coverage | 8/10 | Search Inside returns multiple topic hits across all five preference topics. |
| content depth | 7/10 | Snippets are short, but open IA OCR can yield full paragraphs when an openly readable identifier has a text file. |
| fetch stability | 8/10 | API worked serially with a conservative user-agent; direct text fetch depends on IA file availability. |
| rate-limit behavior | 7/10 | This pilot uses low-volume serial requests; any production workflow should keep throttling and caching metadata only. |
| cleaning complexity | 6/10 | OCR text needs the same boilerplate/reference-note/non-terminal filters already used by RandomPage. |
| passage yield | 8/10 | 20 usable candidates from 20 successful direct text fetches in this small sample. |
| recommendation value | 7/10 | Topic search aligns with existing user goals and can expand book/source discovery without summaries or social feed scope. |

## Candidate samples

| topic | title | author | IA identifier | chars |
|---|---|---|---|---:|
| philosophy | Introduction to the study of philosophy | Stuckenberg, John Henry Wilburn, 1835-1903. [from old catalog] | introductiontos00stu | 1801 |
| philosophy | Recent British Philosophy: A Review, with Criticisms; Including Some Comments on Mr. Mill's ... | David Masson | recentbritishph03massgoog | 1753 |
| philosophy | Ancient European philosophy; the history of Greek philosophy psychologically treated | Snider, Denton Jaques, 1841-1925 | ancienteuropeanp00snid | 1700 |
| philosophy | A brief history of Greek philosophy | Burt, Benjamin Chapman, 1852-1915 | briefhistoryofgr00burt | 1766 |
| philosophy | A history of philosophy in epitome | Schwegler, Albert, 1819-1857 | histphilosophy00schwrich | 1785 |
| philosophy | An Introduction To Indian Philosophy | Satischandra Chatterjee; Dhirendramohan Datta | mlbd.introductiontoin0000sati_t0v5 | 1783 |
| philosophy | Rational philosophy in history and in system: an introduction to a logical and metaphysical course | Fraser, Alexander Campbell, 1819-1914 | rationalphilosop00frasrich | 1675 |
| philosophy | The philosophy of the present in Germany | Külpe, Oswald, 1862-1915 | philosophyofpres00kl | 1886 |
| psychology | A history of psychology | Klemm, Otto, 1884- | historyofpsychol00klemuoft | 1877 |
| psychology | SOCIAL PSYCHOLOGY INTERPRETED | JESSE WILLIAM SPROW | socialpsychology0000jess | 1837 |

Full sample metadata and candidate excerpts are in `docs/openlibrary-search-inside-eval-samples.json`.

## Direct fetch failures sampled

- none in sampled attempts

## Recommendation

Create a follow-up Gap for a reviewed Open Library → IA OCR candidate queue: Search Inside discovers title/author/OLID/IA identifiers for configured RandomPage topics, stores metadata/report only, and requires a reviewed allowlist before running the existing IA OCR ingest path. Keep production import separate from this evaluator; do not cache protected full text, do not turn RandomPage into a generic reader/feed, and do not generate summaries.
