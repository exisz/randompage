#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const history = readFileSync(new URL('../src/client/pages/History.tsx', import.meta.url), 'utf8');

const checks = [
  ['History computes a local day key', history.includes('function localDayKey') && history.includes('date.getFullYear()') && history.includes("padStart(2, '0')")],
  ['History labels Today and Yesterday', history.includes("return 'Today'") && history.includes("return 'Yesterday'")],
  ['History groups filtered rows, preserving search/tag filters', history.includes('const groupedItems = useMemo') && history.includes('for (const item of filteredItems)')],
  ['History groups push reads by readAt before delivery time', history.includes('return item.readAt || item.sentAt')],
  ['History renders day headings with item counts', history.includes('dayHeading(group.dayKey)') && history.includes('group.items.length')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${label}`);
}

if (failed.length) {
  console.error(`\nHistory day grouping policy failed: ${failed.length} check(s) failed.`);
  process.exit(1);
}

console.log('\nHistory day grouping policy passed.');
