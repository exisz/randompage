#!/usr/bin/env node
/**
 * page-photo-ocr-eval.mjs — PLANET-2708
 *
 * Local evaluation prototype for one user-provided physical book page photo.
 * It shells out to the local Tesseract CLI, cleans OCR text, slices it into
 * RandomPage-sized passage candidates, attaches user-supplied metadata, and
 * writes a report/sample JSON. It never writes to Turso or production tables.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const MIN_PASSAGE_CHARS = 180;
const TARGET_PASSAGE_CHARS = 300;
const MAX_PASSAGE_CHARS = 800;
const DEFAULT_REPORT = 'docs/page-photo-ocr-eval-report.md';
const DEFAULT_SAMPLES = 'docs/page-photo-ocr-eval-samples.json';

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(`[page-photo-ocr-eval] ${error.message}`);
  process.exit(1);
});

async function main() {
  if (args.help || !args.image) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const imagePath = path.resolve(process.cwd(), String(args.image));
  if (!existsSync(imagePath)) throw new Error(`image not found: ${imagePath}`);

  const tesseractBin = String(args.tesseract || 'tesseract');
  const lang = String(args.lang || 'eng');
  const psm = String(args.psm || '6');
  const rawOcr = await runTesseract(tesseractBin, imagePath, lang, psm);
  const cleanedText = cleanOcrText(rawOcr);
  const metadata = {
    title: String(args.title || 'Untitled page capture'),
    author: String(args.author || 'Unknown author'),
    source: String(args.source || path.basename(imagePath)),
    captureMode: 'local-page-photo-ocr-evaluation',
    visibility: 'private/import-candidate',
  };
  const candidates = buildCandidates(cleanedText, metadata, Number(args.limit || 3));
  const result = {
    generatedAt: new Date().toISOString(),
    command: `pnpm --filter @randompage/app eval:page-ocr -- --image ${path.relative(APP_ROOT, imagePath)}`,
    image: imagePath,
    ocr: {
      engine: `tesseract:${lang}:psm-${psm}`,
      rawChars: rawOcr.length,
      cleanedChars: cleanedText.length,
      candidateCount: candidates.length,
    },
    metadata,
    candidates,
    remainingWork: [
      'Camera/file-picker UI in Settings or Bookmarks for signed-in users.',
      'Server-side OCR worker or reviewed client-side OCR path before mobile production use.',
      'Explicit user confirmation before saving candidates into Bookmarks or private library.',
      'Safety guardrails for copyrighted full-book expansion: one page/candidate at a time, private by default.',
    ],
  };

  const samplesPath = path.resolve(APP_ROOT, args.samples || DEFAULT_SAMPLES);
  const reportPath = path.resolve(APP_ROOT, args.report || DEFAULT_REPORT);
  await mkdir(path.dirname(samplesPath), { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(samplesPath, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(reportPath, renderReport(result));

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`PAGE_PHOTO_OCR_EVAL - candidates=${candidates.length} cleanedChars=${cleanedText.length}`);
    console.log(`report=${path.relative(APP_ROOT, reportPath)}`);
    console.log(`samples=${path.relative(APP_ROOT, samplesPath)}`);
    for (const candidate of candidates) {
      console.log(`\n#${candidate.index} ${candidate.title} — ${candidate.author}`);
      console.log(candidate.text);
      console.log(`tags=${candidate.suggestedTags.join(', ')}`);
    }
  }

  if (candidates.length < 1) process.exit(2);
}

function parseArgs(argv) {
  const parsed = { json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:\n  pnpm --filter @randompage/app eval:page-ocr -- --image ./page.jpg --title "Book" --author "Author" --source "physical page"\n\nOptions:\n  --image <path>       Required. One clear photo/screenshot of a book page.\n  --title <text>       Optional metadata attached to each candidate.\n  --author <text>      Optional metadata attached to each candidate.\n  --source <text>      Optional source label.\n  --lang <code>        Tesseract language, default eng.\n  --psm <number>       Tesseract page segmentation mode, default 6.\n  --limit <number>     Candidate limit, default 3.\n  --report <path>      Report path under apps/app, default ${DEFAULT_REPORT}.\n  --samples <path>     JSON path under apps/app, default ${DEFAULT_SAMPLES}.\n  --json               Print JSON result.\n`);
}

async function runTesseract(bin, imagePath, lang, psm) {
  try {
    const { stdout } = await execFileAsync(bin, [imagePath, 'stdout', '-l', lang, '--psm', psm], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const detail = error.stderr || error.message;
    throw new Error(`tesseract failed (${detail}). Install tesseract or pass --tesseract <path>.`);
  }
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function cleanOcrText(raw) {
  return String(raw || '')
    .replace(/\r/g, '')
    .replace(/\f/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => {
      if (!line) return true;
      if (/^\d+$/.test(line)) return false;
      if (/^[^A-Za-z]{1,12}$/.test(line)) return false;
      if (/^(contents|index|copyright|all rights reserved|isbn|printed in)\b/i.test(line)) return false;
      return line.length >= 3;
    })
    .join('\n')
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSentences(text) {
  return normalize(text).match(/[^.!?…。！？]+[.!?…。！？]["'”’）)\]》」』]*/g)?.map((s) => s.trim()).filter(Boolean) || [];
}

function buildCandidates(text, metadata, limit) {
  const candidates = [];
  let buffer = '';
  for (const sentence of splitSentences(text)) {
    const next = buffer ? `${buffer} ${sentence}` : sentence;
    if (next.length <= MAX_PASSAGE_CHARS) {
      buffer = next;
      if (buffer.length >= TARGET_PASSAGE_CHARS) {
        maybeAddCandidate(candidates, buffer, metadata);
        buffer = '';
      }
    } else {
      maybeAddCandidate(candidates, buffer, metadata);
      buffer = sentence;
    }
    if (candidates.length >= limit) break;
  }
  if (candidates.length < limit) maybeAddCandidate(candidates, buffer, metadata);
  return candidates.slice(0, limit);
}

function maybeAddCandidate(candidates, text, metadata) {
  const normalized = normalize(text);
  if (!isUsablePassage(normalized)) return;
  candidates.push({
    index: candidates.length + 1,
    id: `ocr-candidate-${String(candidates.length + 1).padStart(2, '0')}`,
    text: normalized,
    charCount: normalized.length,
    title: metadata.title,
    author: metadata.author,
    source: metadata.source,
    visibility: metadata.visibility,
    suggestedTags: suggestTags(normalized),
  });
}

function isUsablePassage(text) {
  if (text.length < MIN_PASSAGE_CHARS || text.length > MAX_PASSAGE_CHARS) return false;
  if (!/[.!?…。！？]["'”’）)\]》」』]*$/.test(text)) return false;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  if (letters / Math.max(1, text.length) < 0.55) return false;
  if (/\b(?:copyright|all rights reserved|isbn|publisher|printed in)\b/i.test(text.slice(0, 260))) return false;
  return true;
}

function suggestTags(text) {
  const lower = text.toLowerCase();
  const tags = ['private', 'import-candidate', 'ocr-candidate', 'book-page'];
  const rules = [
    ['philosophy', /\b(philosophy|wisdom|truth|virtue|soul|reason|stoic|mind)\b/],
    ['psychology', /\b(psychology|habit|memory|attention|emotion|desire|fear)\b/],
    ['history', /\b(history|empire|king|war|century|ancient|revolution)\b/],
    ['literature', /\b(novel|poem|story|character|voice|chapter)\b/],
    ['reflection', /\b(think|thought|question|meaning|learn|understand)\b/],
  ];
  for (const [tag, pattern] of rules) if (pattern.test(lower)) tags.push(tag);
  return [...new Set(tags)].slice(0, 8);
}

function renderReport(result) {
  const samples = result.candidates.map((candidate) => `### Candidate ${candidate.index}\n\n- title: ${candidate.title}\n- author: ${candidate.author}\n- source: ${candidate.source}\n- chars: ${candidate.charCount}\n- tags: ${candidate.suggestedTags.join(', ')}\n\n> ${candidate.text}\n`).join('\n');
  return `# PLANET-2708 — Page photo OCR capture evaluation\n\nGenerated: ${result.generatedAt}\n\n## Summary\n\n- image: ${result.image}\n- OCR engine: ${result.ocr.engine}\n- raw OCR chars: ${result.ocr.rawChars}\n- cleaned OCR chars: ${result.ocr.cleanedChars}\n- passage candidates: ${result.ocr.candidateCount}\n- production writes: none; candidates are ${result.metadata.visibility}\n\n## Product read\n\nA clear single-page image can be converted into RandomPage-shaped passage candidates with user-supplied title/source metadata. The resulting candidates are readable enough for a future reviewed save/import path when OCR quality is good; production should still require explicit user confirmation before adding anything to Bookmarks/Discover.\n\n## Sample candidates\n\n${samples || '_No usable candidates produced. OCR quality or image clarity failed the minimum passage checks._'}\n## Remaining engineering work\n\n${result.remainingWork.map((item) => `- ${item}`).join('\n')}\n`;
}
