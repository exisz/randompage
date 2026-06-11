# PLANET-2708 — Page photo OCR capture evaluation

Generated: 2026-06-11T18:14:37.251Z

## Summary

- image: /Users/c/repos/randompage/apps/app/docs/page-photo-ocr-fixture.png
- OCR engine: tesseract:eng:psm-6
- raw OCR chars: 1173
- cleaned OCR chars: 1172
- passage candidates: 3
- production writes: none; candidates are private/import-candidate

## Product read

A clear single-page image can be converted into RandomPage-shaped passage candidates with user-supplied title/source metadata. The resulting candidates are readable enough for a future reviewed save/import path when OCR quality is good; production should still require explicit user confirmation before adding anything to Bookmarks/Discover.

## Sample candidates

### Candidate 1

- title: Meditations
- author: Marcus Aurelius
- source: local clear page-photo fixture for PLANET-2708
- chars: 650
- tags: private, import-candidate, ocr-candidate, book-page, philosophy

> MEDITATIONS Marcus Aurelius Begin the morning by saying to yourself: I shall meet with the busybody, the ungrateful, arrogant, deceitful, envious, and unsocial. All these things happen to them by reason of their ignorance of what is good and evil. But I who have seen the nature of the good that it is beautiful, and of the bad that it is ugly, and the nature of him who does wrong, that it is akin to me, not of the same blood or seed, but that it participates in the same intelligence and the same portion of divinity, I can neither be injured by any of them, for no one can fix on me what is ugly, nor can I be angry with my kinsman, nor hate him.

### Candidate 2

- title: Meditations
- author: Marcus Aurelius
- source: local clear page-photo fixture for PLANET-2708
- chars: 316
- tags: private, import-candidate, ocr-candidate, book-page

> For we are made for cooperation, like feet, like hands, like eyelids, like the rows of the upper and lower teeth. To act against one another then is contrary to nature; and it is acting against one another to be vexed and to turn away. Whatever this is that I am, it is a little flesh and breath and the ruling part.

### Candidate 3

- title: Meditations
- author: Marcus Aurelius
- source: local clear page-photo fixture for PLANET-2708
- chars: 200
- tags: private, import-candidate, ocr-candidate, book-page

> Throw away thy books; no longer distract thyself, it is not allowed; but as if thou wast now dying, despise the flesh; it is blood and bones and a network, a contexture of nerves, veins, and arteries.

## Remaining engineering work

- Camera/file-picker UI in Settings or Bookmarks for signed-in users.
- Server-side OCR worker or reviewed client-side OCR path before mobile production use.
- Explicit user confirmation before saving candidates into Bookmarks or private library.
- Safety guardrails for copyrighted full-book expansion: one page/candidate at a time, private by default.
