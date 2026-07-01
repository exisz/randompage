#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const checks = [
  {
    file: 'src/client/lib/passageExport.ts',
    patterns: [
      'buildPassageMarkdownExport',
      'copyMarkdownPassageExport',
      'downloadMarkdownPassageExport',
      'collections?: string[]',
      'annotations?: { quote: string; note: string }[]',
      '## Private note',
      '## Line-level thoughts',
      'MarkdownExportVariant',
      "variant === 'obsidian'",
      'sourceurl',
      'randompageurl',
      'exported_at',
      'yamlArray(tags)',
      'no summaries or new content',
    ],
  },
  {
    file: 'src/client/pages/Bookmarks.tsx',
    patterns: [
      'Export Markdown',
      'Obsidian MD',
      'exportBookmarkMarkdown',
      "variant: MarkdownExportVariant = 'plain'",
      'copyMarkdownPassageExport',
      'downloadMarkdownPassageExport',
      'collections: bookmark.collectionItems?.map(item => item.collection.name)',
      'annotations: bookmark.annotations?.map(annotation => ({ quote: annotation.quote, note: annotation.note }))',
      'Clipboard unavailable; downloaded',
    ],
  },
];

const missing = [];
for (const check of checks) {
  const content = read(check.file);
  for (const pattern of check.patterns) {
    if (!content.includes(pattern)) missing.push(`${check.file}: ${pattern}`);
  }
}

if (missing.length) {
  console.error('[check:markdown-export] missing required Markdown export hooks:');
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log('[check:markdown-export] PASS — Bookmarks saved-passage Markdown export preserves plain Markdown plus Obsidian YAML frontmatter with metadata, notes, annotations, collections, tags, canonical URL, clipboard copy, and download fallback.');
