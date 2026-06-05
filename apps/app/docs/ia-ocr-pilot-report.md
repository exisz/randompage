# PLANET-2502 — Internet Archive OCR fetch-to-passages pilot

Generated: 2026-06-05T02:20:23.265Z

## Command

```bash
pnpm --filter @randompage/app pilot:ia-ocr -- --limit 10
```

## Summary

- Items evaluated: 10
- Successes: 10/10 (100%)
- Candidate passages: 2315
- Average clean-text chars among successes: 904495
- Gate: at least 5/10 successes and >=50 passages → PASS

## Item results

| # | Topic | Identifier | Title | Author | Status | Clean chars | Passages | Notes |
|---:|---|---|---|---|---|---:|---:|---|
| 1 | philosophy | kybalionstudyofh00thre | The Kybalion; a study of the hermetic philosophy of ancient Egypt and Greece, by Three Initiates | Three Initiates, 1862-1932 | success | 204920 | 52 | kybalionstudyofh00thre_djvu.txt |
| 2 | psychology | influencinghuman00over | Influencing human behavior | Overstreet, H. A. (Harry Allen), 1875-1970 | success | 484140 | 223 | influencinghuman00over_djvu.txt |
| 3 | history | rosterofohiosold01ohio | Roster of Ohio soldiers in the War of 1812 | Ohio. Adjutant General's Office | success | 544246 | 338 | rosterofohiosold01ohio_djvu.txt |
| 4 | literature | harpersmagazine294295jana | Harper's magazine | Alden, Henry Mills, 1836-1919; Wells, Thomas B. (Thomas Bucklin), 1875-1944; Hartman, Lee Foster, 1879-1941; Allen, Fred | success | 3996137 | 500 | harpersmagazine294295jana_djvu.txt |
| 5 | essays | essaysofelia0000lamb_g1n7 | Essays of Elia | Lamb, Charles, 1775-1834 | success | 892117 | 294 | essaysofelia0000lamb_g1n7_djvu.txt |
| 6 | philosophy | philosophyofnatu00lind | Philosophy of natural therapeutics | Lindlahr, Henry, 1862-1924 | success | 940241 | 433 | philosophyofnatu00lind_djvu.txt |
| 7 | psychology | understandinghum00adlerich | Understanding human nature | Adler, Alfred, 1870-1937 | success | 519716 | 137 | understandinghum00adlerich_djvu.txt |
| 8 | history | cloudofunknowing0000unse_h8l5 | The cloud of unknowing, and other treatises | Unknown | success | 548475 | 130 | cloudofunknowing0000unse_h8l5_djvu.txt |
| 9 | essays | mindenergylectur0000berg_n5y3 | Mind-energy, lectures and essays | Bergson, Henri, 1859-1941 | success | 378428 | 84 | mindenergylectur0000berg_n5y3_djvu.txt |
| 10 | philosophy | histoiredelaphil00br | Histoire de la philosophie | Bréhier, Emile, 1876-1952 | success | 536529 | 124 | histoiredelaphil00br_djvu.txt |

## Quality notes

- IA metadata lookup plus `_djvu.txt`/OCR plaintext download is enough to produce RandomPage-sized passages for the successful items.
- OCR quality varies by scan; common cleanup needs are page numbers, digitization boilerplate, hyphenated line breaks, and footnote/reference-note fragments.
- The pilot uses the existing RandomPage passage bounds: target ~300 chars, accepted 180–800 chars, sentence-terminal endings only.
- This run only writes local cache/report artifacts; it does not insert rows into Turso.

## Rate-limit / retry approach

- Serial requests only, with a descriptive User-Agent.
- 250ms delay between cached text downloads/search groups.
- Retries only for 429/5xx responses, with short linear backoff.
- Future ingestion should keep small batches and persist item-level failures before scaling.

## Recommendation

Create a follow-up Engineer ticket to turn this into a guarded small-batch IA OCR ingestion path (still serial, rate-limited, and review-first), reusing the existing passage content/length checks before any production insert.

## Sample passages

### The Kybalion; a study of the hermetic philosophy of ancient Egypt and Greece, by Three Initiates — Three Initiates, 1862-1932

IA: https://archive.org/details/kybalionstudyofh00thre

> CHICAGO, ILL. THE YOGI PUBLICATION SOCIETY. Entered at Stationer's Hall. Chapter. Page. INTRODUCTION. Truths will doubtless welcome the appearance of the present volume. and disgust the beginner in the study. main portals he has already entered. Hermetic Teachings. Egypt, and sat at the feet of the Master.

> as the Great Eeconciler. has been handed down among the few. holy temples cherished. Fed by pure ministers of love — let not the flame die out!" recognize it if it were presented to them. while others furnish the "milk for babes." those ready for his Teaching open wide." understood only by the elect who had advanced along The Path.

### Influencing human behavior — Overstreet, H. A. (Harry Allen), 1875-1970

IA: https://archive.org/details/influencinghuman00over

> W-W- NORTON fcf COMPANY, INC. WW- NORTON 6? COMPANY, INC. psychology can furnish us. Our interest is not academic. may gain." valuable material contributed by the members of the class. in other cases it has been slipped into the body of the text. but the limits of space have forbidden. urgent problems of human behavior.

> can easily be counted. furthering what is really the central concern of our lives. central problem? Obviously, it is to be, in some worthwhile manner, effective within our human environment. ing the good things he has to say really understandable. potential customers whom we must induce to buy our product. If they refuse, then bankruptcy.

### Roster of Ohio soldiers in the War of 1812 — Ohio. Adjutant General's Office

IA: https://archive.org/details/rosterofohiosold01ohio

> THE ADJUTANT GENERAL OF OHIO. (House Bill No. 572.) Ohio soldiers in the war with Spain. Washington. the supervisor of public printing. as may be necessary for the purpose. To each member of the general assembly, ten copies. D. C, seventy copies. of the official records of his office, one copy.

> To the state library, fifty copies for exchanges, and ten copies to be retained permanently therein. To each incorporated public library of the state, one copy. to his successor as other public records, one copy. the same person. Speaker of the House of Representatives. President pro tern, of the Senate.

### Harper's magazine — Alden, Henry Mills, 1836-1919; Wells, Thomas B. (Thomas Bucklin), 1875-1944; Hartman, Lee Foster, 1879-1941; Allen, Frederick Lewis, 1890-1954; Rouben Mamoulian Collection (Library of Congress) DLC

IA: https://archive.org/details/harpersmagazine294295jana

> Svsassas? ol a miidefneanor. that met the same fate as one of her eggs. t even saved our groceries. into another pan when bottom of the friitatu is set. Cook another I or 2 minutes. Repeat with other half of ingredients. Serves 6. around a steel spaceframe. spend $40,000 to feel safe. A Different Kind ^>/ Company. A Different kind .':' Car.

> like lax and license. We'd he happy /<. prnvule mn,e delad al I -S0II-M2- iOOfl „r luok /nr us on llic Inlemel at littjKllwww.satmncars.cum. ©1996 Saturn Ojrporation. growing region in France. And . . . 88 Richard E. Maltby]r. 0 queries or manuscripts will be cimsidered unless they .ire atC(Hiip:inie(l by ;i self .iddresseil, stamped envelope. Visii our Web site at In tp://www,li:irpers.org.

### Essays of Elia — Lamb, Charles, 1775-1834

IA: https://archive.org/details/essaysofelia0000lamb_g1n7

> CHARLES E. MERRILL CO. CHARLES E. MERRILL CO. lyn, N. Y. 156 pages, 12mo, cloth. Price 25 cents. W. Abernethy, Ph.D. 634 pages, 12mo, cloth. Price 50 cents. Emerson. Essays. (Selected.) Edited by Edna H. cloth. Price 40 cents. Goldsmith. The Deserted Village, and other Poems. cloth. Price 25 cents.

> pages, 12mo, cloth. Price 40 cents. A.M. 589 pages, 12mo, cloth. Price 50 cents. Copyright, 1908, by Charles E. Merrill Co. the work, as well as to define the more difficult words. J. H. C. Nov. 15, 1907. acterize the editing of every book in the series. rigidly excluded. CHARLES E. MERRILL CO.

