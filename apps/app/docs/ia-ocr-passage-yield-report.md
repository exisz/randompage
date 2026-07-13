# PLANET-3696 — Reviewed IA/OCR passage-yield evaluation

Generated: 2026-07-13T18:15:38.054Z
Reviewed allowlist: `docs/ia-ocr-passage-yield-reviewed-fixture.json`

## Command

```bash
pnpm --filter @randompage/app eval:ia-ocr-passage-yield -- --max-items 5
```

## Summary

- Total reviewed candidates: 5
- Text fetched count: 5
- Clean candidate passages: 2134
- Average passages / usable book: 426.8
- Metadata-only: 0
- Search-inside/snippet-only or unusable fetched text: 0
- OCR/plaintext usable: 5
- Failed/blocked: 0

## Verdict

At least 5 reviewed items produced clean candidate passages; IA/OCR is worth a guarded follow-up ingest batch.

## Top failure modes

| Failure mode | Count |
|---|---:|
| none | 0 |

## Item results

| # | Classification | IA identifier | Title | Author | HTTP | Pages | Raw chars | Clean chars | Passages | Notes |
|---:|---|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | ocr-plaintext-usable | recentbritishph03massgoog | Recent British Philosophy: A Review, with Criticisms; Including Some Comments on Mr. Mill's ... | David Masson | 200 | 289 | 480396 | 469339 | 272 | recentbritishph03massgoog_djvu.txt |
| 2 | ocr-plaintext-usable | mlbd.introductiontoin0000sati_t0v5 | An Introduction To Indian Philosophy | Satischandra Chatterjee; Dhirendramohan Datta | 200 | 470 | 895444 | 874774 | 500 | mlbd.introductiontoin0000sati_t0v5_djvu.txt |
| 3 | ocr-plaintext-usable | socialpsychology0000jess | SOCIAL PSYCHOLOGY INTERPRETED | JESSE WILLIAM SPROW | 200 | 294 | 649629 | 634867 | 500 | socialpsychology0000jess_djvu.txt |
| 4 | ocr-plaintext-usable | bibleasenglishli0000jhga | THe bible as english literature | J.H. Gardiner | 200 | 424 | 548339 | 531995 | 381 | bibleasenglishli0000jhga_djvu.txt |
| 5 | ocr-plaintext-usable | latinandgreekin00kelsgoog | Latin and Greek in American Education: With Symposia on the Value of Humanistic Studies | Francis Willey Kelsey | 200 | 427 | 755086 | 735506 | 481 | latinandgreekin00kelsgoog_djvu.txt |

## Safety boundary

- Only rows with `reviewed=true` and `allowOcrFetch=true` are fetched.
- This CLI writes local report/cache artifacts only; no Turso client, no mutation SQL, and no Discover/random sampling change.
- Candidate passages reuse RandomPage length/content filters and remain review artifacts until a separate approved ingest path is run.

## Sample passages for human review

### Recent British Philosophy: A Review, with Criticisms; Including Some Comments on Mr. Mill's ... — David Masson

IA: https://archive.org/details/recentbritishph03massgoog

> recluse, I cannot think that the tradition of our national * Review of Professor Sedgwick's Discourse on the Studies of Cambridge, 1835 ; reprinted in Mill's Dissertations, 4 RECENT BRITISH PHILOSOPHY.

> authority be wanted to the same eflect, it may be found in writings of Mr. Carlyle at about the same date. " It " is admitted on all sides,'*^ he had written in one of his Essays as early as 1829, "that the Metaphysical and " Moral sciences are faUing into decay, while the Physical " are engrossing, every day, more respect and attention.

> such minds may be taken as evidence, if not that Philosophy was then at a lower ebb than usual in Britain, at least that such British Philosophy as was current did not come up to the standard of the best critics, whether judging by their own requirements and aspirations, or by comparison with other nations.

### An Introduction To Indian Philosophy — Satischandra Chatterjee; Dhirendramohan Datta

IA: https://archive.org/details/mlbd.introductiontoin0000sati_t0v5

> 3. Ramanuja’s Conception of the Self, Bondage and Liberation 421 INDEX 431 PREFACE TO THE FIRST EDITION The object of this book is to provide a simple introduction to the Indian systems of philosophy. Each one of these systems has had a vast and varied development and cannot be treated adequately in a brief work like this.

> theories. Their long experience with university students has helped the authors to realise these, and they have tried to remove them as far as possible. This accounts for most of the critical discussions which could otherwise have been dispensed with. The book has been primarily written for beginners.

> The first chapter which contains the general principles and basic features of Indian philosophy, as well as a brief sketch of each system, gives the student a bird’s-eye view of the entire field and prepares him for a more intensive study of the systems which are contained in the following chapters.

### SOCIAL PSYCHOLOGY INTERPRETED — JESSE WILLIAM SPROW

IA: https://archive.org/details/socialpsychology0000jess

> order to provide the students with the materials for an orientation to this vast and increasing body of literature, it has seemed best to select such references as may be collected for a reserve shelf. The present volume therefore is a mere guide to the study.

> A survey of the development of the sciences of psychology and sociology and their separate contributions is basic for an understanding of social psychology. A very brief account is here attempted.

> not hastily conclude that there is a distinct science of social psychology. Social psychology in general keeps in close contact with knowledge of human institutional and cultural development on the one hand, and with that pertaining to individual psychology on the other.

### THe bible as english literature — J.H. Gardiner

IA: https://archive.org/details/bibleasenglishli0000jhga

> instinct, for all that Emerson has said, which puts the sayings of Isaiah and of Amos, of St. Paul and of St. John on a higher level than the sayings of Socrates or of Marcus Aurelius, and puts the words of Jesus in a place apart and above them all. The older and normal classification is merely a recognition of established facts in history and literature.

> Testament, we come to books which were written in a modern and Western language, when the Roman empire held undisputed sway over the world. Thus in point of time the work that we shall be studying ranges in origin from some time before 1200 B.c. to at least as late as the end of the first ‘century A.D.

> without any break which could make the pious Jew of the fourth century B.o. feel himself cut loose from ancestors of the tenth or fifteenth century n.c. whose religion and worship had close kinship to those of other desert tribes.

### Latin and Greek in American Education: With Symposia on the Value of Humanistic Studies — Francis Willey Kelsey

IA: https://archive.org/details/latinandgreekin00kelsgoog

> 1. James Bryce, Ambassador of Great Britain 210 2. James Loeb (Formerly of Kuhn, Loeb & Co.), New York 211 3. William Sloane, President of W. & J. Sloane, New York 217 II. The Study of the Classics as a Training for Men OF Affairs 219 John W. Foster, Washington, D.C.

> III. The Study of Latin and Greek as a Training for Practical Life 226 Charles R. Williams, Editor of the Indianapolis News IV. The Value of the Study of Greek and Latin as A Preparation for the Study of Science . 238 Harvey W. Wiley, Washington, D.C. V. The Classics and Modern Life 255 James Brown Scott, Washington, D.C.

> in that direction has already begim. The time has come for the fresh consideration of course-making along constructive lines; we are justified, therefore, in entering upon an inquiry as to the place which Latin and Greek now have, and should have, in our courses of study.

