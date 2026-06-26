# Open Library → IA OCR reviewed candidate queue — PLANET-3180

Generated: 2026-06-26T18:17:43.165Z
Source eval artifact: `docs/openlibrary-search-inside-eval-samples.json`

## Summary

- Candidate queue rows: 23
- Human-reviewed rows: 0
- Default safety posture: rows are `reviewed:false` unless explicitly marked with `--mark-reviewed` after human review.
- This queue stores metadata/snippets/readability flags only. It does not fetch OCR/plaintext and does not copy full passage candidate text.
- Next reviewed import command, after manually editing `docs/openlibrary-ia-reviewed-items.json` or using `--mark-reviewed` for an explicit allowlist:

```bash
pnpm --filter @randompage/app ingest:ia-ocr -- --reviewed docs/openlibrary-ia-reviewed-items.json --max-items 2 --max-passages-per-item 10
```

Use `--apply --ack-reviewed` only for a tiny reviewed batch after inspecting the dry-run report.

## Queue

| # | reviewed | score | topic | title | author | IA identifier | source |
|---:|---|---:|---|---|---|---|---|
| 1 | no | 89 | philosophy | Recent British Philosophy: A Review, with Criticisms; Including Some Comments on Mr. Mill's ... | David Masson | recentbritishph03massgoog | https://openlibrary.org/books/OL20501351M/Recent_British_Philosophy_A_Review_with_Criticisms_Including_Some_Comments_on_Mr._Mill's_... |
| 2 | no | 89 | philosophy | An Introduction To Indian Philosophy | Satischandra Chatterjee; Dhirendramohan Datta | mlbd.introductiontoin0000sati_t0v5 | https://openlibrary.org/books/OL58949174M/An_Introduction_To_Indian_Philosophy |
| 3 | no | 88 | psychology | SOCIAL PSYCHOLOGY INTERPRETED | JESSE WILLIAM SPROW | socialpsychology0000jess | https://openlibrary.org/books/OL59045933M/SOCIAL_PSYCHOLOGY_INTERPRETED |
| 4 | no | 88 | literature | THe bible as english literature | J.H. Gardiner | bibleasenglishli0000jhga | https://openlibrary.org/books/OL58596037M/THe_bible_as_english_literature |
| 5 | no | 88 | classics | Latin and Greek in American Education: With Symposia on the Value of Humanistic Studies | Francis Willey Kelsey | latinandgreekin00kelsgoog | https://openlibrary.org/books/OL6531869M/Latin_and_Greek_in_American_education |
| 6 | no | 88 | history | Catalogue of the Apprentices' Library in New York: Established and Supported by the General ... | General Society of Mechanics and Tradesmen of the City of New York Library | catalogueappren01librgoog | https://openlibrary.org/books/OL20485319M/Catalogue_of_the_Apprentices'_Library_in_New_York_Established_and_Supported_by_the_General_... |
| 7 | no | 88 | classics | American stories | Hale, Edward Everett, 1822-1909 | americanstories00halegoog | https://openlibrary.org/books/OL23379358M/American_stories |
| 8 | no | 88 | literature | Lectures on English literature, from Chaucer to Tennyson | Reed, Henry, 1808-1854. [from old catalog] | lecturesonenglis00reed_1 | https://openlibrary.org/books/OL25583279M/Lectures_on_English_literature_from_Chaucer_to_Tennyson |
| 9 | no | 88 | psychology | A history of psychology | Klemm, Otto, 1884- | historyofpsychol00klemuoft | https://openlibrary.org/books/OL7083190M/A_history_of_psychology |
| 10 | no | 88 | literature | Voices of October, art and literature in soviet Russia | Freeman, Joseph, 1897-1965 | voicesofoctober0000unse | https://openlibrary.org/books/OL6742845M/Voices_of_October |
| 11 | no | 88 | philosophy | A brief history of Greek philosophy | Burt, Benjamin Chapman, 1852-1915 | briefhistoryofgr00burt | https://openlibrary.org/books/OL24605951M/A_brief_history_of_Greek_philosophy |
| 12 | no | 88 | philosophy | Ancient European philosophy; the history of Greek philosophy psychologically treated | Snider, Denton Jaques, 1841-1925 | ancienteuropeanp00snid | https://openlibrary.org/books/OL13504299M/Ancient_European_philosophy |
| 13 | no | 88 | classics | The German classics of the nineteenth and twentieth centuries: masterpieces of German literature, tr. into English | Francke, Kuno, 1855-1930, ed | cu31924087727065 | https://openlibrary.org/books/OL24155144M/The_German_classics_of_the_nineteenth_and_twentieth_centuries |
| 14 | no | 88 | philosophy | A history of philosophy in epitome | Schwegler, Albert, 1819-1857 | histphilosophy00schwrich | https://openlibrary.org/books/OL14013488M/A_history_of_philosophy_in_epitome |
| 15 | no | 88 | philosophy | Introduction to the study of philosophy | Stuckenberg, John Henry Wilburn, 1835-1903. [from old catalog] | introductiontos00stu | https://openlibrary.org/books/OL25388661M/Introduction_to_the_study_of_philosophy |
| 16 | no | 88 | history | Suggestions for the teaching of history and civics in the high school | Krey, August C. (August Charles), 1887-1961 | suggestionsforte00kreyrich | https://openlibrary.org/books/OL7175660M/Suggestions_for_the_teaching_of_history_and_civics_in_the_high_school |
| 17 | no | 88 | philosophy | Rational philosophy in history and in system: an introduction to a logical and metaphysical course | Fraser, Alexander Campbell, 1819-1914 | rationalphilosop00frasrich | https://openlibrary.org/books/OL7167694M/Rational_philosophy_in_history_and_in_system |
| 18 | no | 88 | philosophy | The philosophy of the present in Germany | Külpe, Oswald, 1862-1915 | philosophyofpres00kl | https://openlibrary.org/books/OL6561014M/The_philosophy_of_the_present_in_Germany |
| 19 | no | 88 | history | The philosophy of history in France and Germany | Flint, Robert, 1838-1910 | thephilosophyofh00flinuoft | https://openlibrary.org/books/OL7160316M/The_philosophy_of_history_in_France_and_Germany |
| 20 | no | 86 | history | Decimal classification and relative [sic] index for Libraries, clippings, notes, etc | Dewey, Melvil, 1851-1931 | de00cimalclassificdewerich | https://openlibrary.org/books/OL19375790M/Decimal_classification_and_relative_sic_index_for_Libraries_clippings_notes_etc. |
| 21 | no | 58 | classics | The miraculous pitcher, and biographical stories | Hawthorne, Nathaniel, 1804-1864 | miraculouspitche00hawt | https://openlibrary.org/books/OL26257859M/The_miraculous_pitcher_and_biographical_stories |
| 22 | no | 58 | classics | [Publications] | Oxford Historical Society | publicationsoxf27oxfouoft | https://openlibrary.org/books/OL7068190M/Publications |
| 23 | no | 56 | classics | Eton school lists from 1791 to 1877, with notes and index | Unknown | etonschoollistsf00lond | https://openlibrary.org/books/OL24237980M/Eton_school_lists_from_1791_to_1877_with_notes_and_index. |

## Boundary

- Search Inside is discovery/ranking only.
- IA OCR/plaintext fetch is gated by the reviewed allowlist consumed by `ia-ocr-ingest.mjs`.
- The ingest path reuses RandomPage length/content filters before any row can become a passage.
- No protected full-text cache, summaries, generic reader/feed, or production writes are performed by this queue builder.
