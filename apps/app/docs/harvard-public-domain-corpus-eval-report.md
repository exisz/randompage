# Harvard Public Domain Corpus / Institutional Books 1.0 eval — PLANET-3911

Generated: 2026-07-21T14:25:18.853Z

## Scope

Local evaluation only. This command writes JSON/Markdown artifacts under `apps/app/docs`, never connects to Turso, never writes production data, and does not create summaries or substitute content.

## Source access facts

- Harvard corpus page: https://library.harvard.edu/services-tools/harvard-library-public-domain-corpus
- Full dataset card: https://huggingface.co/datasets/institutional/institutional-books-1.0
- Metadata dataset card: https://huggingface.co/datasets/institutional/institutional-books-1.0-metadata
- Published scale reported by source: 983,004 public-domain books, ~242B tokens, ~386M pages; full dataset is ~947 GB parquet.
- Metadata rows sampled: 8 from offset 0; English/book-like rows selected: 6.
- Full-text access mode: missing HF_TOKEN/HUGGINGFACE_TOKEN for gated full-text dataset.
- Full-text parquet listing: 1000 shards listed; first shard 69053194 bytes.

## Text fetch / yield result

- Text rows attempted: 0
- Text fetch successes: 0
- Rows with clean RandomPage candidate snippets: 0
- Average candidate snippets per successful sampled book: n/a
- Verdict: **metadata_promising_but_text_access_gated**

## Recommendation

Do not build production ingest yet. The public metadata path is stable and high-scale, but direct OCR text access is gated/too heavy for an unauthenticated local eval. Next step is to obtain accepted Hugging Face/IDI access and rerun this command with `HF_TOKEN`; only then decide whether a reviewed ingest queue is justified.

## Boundary check

- Existing book passage candidates only.
- No summaries, LLM-derived substitute content, full-reader UI, social/feed/paywall layer, or direct unreviewed Discover/push exposure.
- Any follow-up ingest must be dry-run by default and require human reviewed allowlist + explicit apply acknowledgement.

## Sample metadata rows

1. Geology of Massachusetts and Rhode Island. — Emerson, Benjamin Kendall (1917); lang=eng; tokens=201834; ocr=98; hathi=https://hdl.handle.net/2027/hvd.32044000000018
2. A history of Japanese mathematics — Smith, David Eugene (1914); lang=eng; tokens=126171; ocr=94; hathi=https://hdl.handle.net/2027/hvd.32044000028530
3. Rara arithmetica : a catalogue of the arithmetics written before the year MDCI with a description of those in the library of George Arthur Plimpton, of New York — Smith, David Eugene (1908); lang=eng; tokens=269698; ocr=78; hathi=https://hdl.handle.net/2027/hvd.32044000028563
4. A first course in the differential and integral calculus — Osgood, William F. (1911); lang=eng; tokens=179676; ocr=84; hathi=https://hdl.handle.net/2027/hvd.32044000046607
5. The different forms of flowers on plants of the same species — Darwin, Charles (1896); lang=eng; tokens=164383; ocr=99; hathi=https://hdl.handle.net/2027/hvd.32044000055715

## Sample candidate snippets

No full-text snippets emitted in this run because OCR text access was not available. The JSON artifact still includes sampled metadata and fetch errors for follow-up.
