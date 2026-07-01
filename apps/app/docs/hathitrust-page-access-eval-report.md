# HathiTrust OCR/page-access passage-source pilot — PLANET-3364

Generated: 2026-07-01T18:17:52.687Z

## Verdict

**B: viable for metadata/access discovery; direct OCR/page text is not reliably obtainable unauthenticated in this environment**

This evaluator treats HathiTrust as a possible high-scale book source, but only if page OCR/text is practically obtainable for reviewed volumes. It does not make a copyright/license decision and does not import anything into production. The measured question is operational: metadata coverage, public/full-view flags, unauthenticated OCR/page text access, cleaning complexity, and RandomPage-style passage yield.

## Counts

- candidate seeds tested: 15
- HathiTrust metadata successes: 15
- candidate volumes tested for page OCR: 13
- volumes marked full-view/public-likely: 6
- OCR/page text successes: 0
- all-page access failures: 13
- usable RandomPage-style passage candidates emitted: 0

| topic | seeds | metadata successes | volumes tested | full-view/public-likely | OCR/page successes | usable passages |
|---|---:|---:|---:|---:|---:|---:|
| philosophy | 3 | 3 | 1 | 0 | 0 | 0 |
| psychology | 3 | 3 | 1 | 1 | 0 | 0 |
| history | 3 | 3 | 1 | 0 | 0 | 0 |
| literature | 3 | 3 | 5 | 1 | 0 | 0 |
| classics | 3 | 3 | 5 | 4 | 0 | 0 |

## Source scoring

| dimension | score | note |
|---|---:|---|
| coverage | 7/10 | Bibliographic lookup found records/items for 15/15 aligned seed works. |
| content depth | 3/10 | Page-level OCR can be deep when obtainable, but this run produced 0 successful OCR/page volume probes. |
| fetch stability | 3/10 | Metadata API was stable; page OCR access had 13 all-page failures among tested volumes. |
| rate limits/access requirements | 3/10 | Low-volume serial requests were used; failures indicate access/browser-gating/auth constraints may dominate. |
| cleaning complexity | 6/10 | OCR requires the same boilerplate/reference/non-terminal filters RandomPage already uses. |
| passage yield | 2/10 | 0 usable ~300-word candidates in this bounded run. |
| recommendation value | 7/10 | If OCR were obtainable, HathiTrust breadth would align well with philosophy/psychology/history/literature/classics discovery. |

## Candidate volumes

| topic | intended seed | actual HathiTrust title | htid | rights | access flag | page probes ok | text chars | passage? |
|---|---|---|---|---|---|---:|---:|---|
| philosophy | Meditations / Marcus Aurelius | Meditations | hvd.32044050117126 | ic | Limited (search-only) | 0/4 | 0 | no |
| psychology | Principles of Psychology / William James | Josiah Bushnell Grinnell | mdp.39015022468816 | pd | Full view | 0/4 | 0 | no |
| history | Peloponnesian War / Thucydides | History of the Peloponnesian War | ucbk.ark:/28722/h2jd4q483 | ic | Limited (search-only) | 0/4 | 0 | no |
| literature | Hamlet / Shakespeare | Modern drama | uc1.31175000452303 | und | Limited (search-only) | 0/4 | 0 | no |
| literature | Hamlet / Shakespeare | Modern drama | uc1.l0054596499 | ic | Limited (search-only) | 0/4 | 0 | no |
| literature | Hamlet / Shakespeare | Modern drama | ufl.31262074536656 | ic | Limited (search-only) | 0/4 | 0 | no |
| literature | Hamlet / Shakespeare | Modern drama | uc1.31175000452311 | und | Limited (search-only) | 0/4 | 0 | no |
| literature | Moby-Dick / Melville | The midge | uva.x002111831 | pd | Full view | 0/4 | 0 | no |
| classics | Odyssey / Homer | Bulletin du Comité des travaux historiques et scientifiques. Section des sciences économiques et sociales | umn.31951001915271g | pd | Full view | 0/4 | 0 | no |
| classics | Odyssey / Homer | Bulletin du Comité des travaux historiques et scientifiques. Section des sciences économiques et sociales | njp.32101065210898 | pd | Full view | 0/4 | 0 | no |
| classics | Odyssey / Homer | Bulletin du Comité des travaux historiques et scientifiques. Section des sciences économiques et sociales | uc1.b2897057 | pd | Full view | 0/4 | 0 | no |
| classics | Odyssey / Homer | Bulletin du Comité des travaux historiques et scientifiques. Section des sciences économiques et sociales | wu.89008108904 | pd | Full view | 0/4 | 0 | no |
| classics | Divine Comedy / Dante | Los intelectuales y la política en México | txu.059173027073247 | ic | Limited (search-only) | 0/4 | 0 | no |

## Candidate passage samples

| topic | title | htid | chars |
|---|---|---|---:|
| — | — | — | 0 |

Full metadata, per-page attempts, and candidate excerpts are in `docs/hathitrust-page-access-eval-samples.json`.

## Access failures sampled

- hvd.32044050117126 page 1: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- hvd.32044050117126 page 5: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- mdp.39015022468816 page 1: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- mdp.39015022468816 page 5: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- ucbk.ark:/28722/h2jd4q483 page 1: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- ucbk.ark:/28722/h2jd4q483 page 5: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- uc1.31175000452303 page 1: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- uc1.31175000452303 page 5: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- uc1.l0054596499 page 1: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- uc1.l0054596499 page 5: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- ufl.31262074536656 page 1: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- ufl.31262074536656 page 5: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- uc1.31175000452311 page 1: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- uc1.31175000452311 page 5: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- uva.x002111831 page 1: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- uva.x002111831 page 5: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- umn.31951001915271g page 1: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- umn.31951001915271g page 5: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- njp.32101065210898 page 1: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm
- njp.32101065210898 page 5: HTTP 403 Forbidden — <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/htm

## Recommendation

Do not prioritize HathiTrust as a direct RandomPage passage source until unauthenticated OCR/page text access is proven reliable from the deployment/developer environment. Treat it as metadata/access discovery only and keep near-term corpus-growth effort on the existing Gutendex / Open Library → IA OCR reviewed paths.
