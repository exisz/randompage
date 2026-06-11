import { readFileSync } from 'node:fs';

const checks = [
  ['share component uses Web Share API', 'src/client/components/SharePassageButton.tsx', 'navigator.share'],
  ['share component falls back to clipboard', 'src/client/components/SharePassageButton.tsx', 'navigator.clipboard.writeText'],
  ['share text includes RandomPage URL', 'src/client/components/SharePassageButton.tsx', 'Read it on RandomPage'],
  ['share URL targets exact passage', 'src/client/components/SharePassageButton.tsx', '/discover?passageId='],
  ['Discover current card renders SharePassageButton', 'src/client/pages/Discover.tsx', '<SharePassageButton passage={passage}'],
  ['Discover Daily Review renders SharePassageButton', 'src/client/pages/Discover.tsx', '<SharePassageButton passage={item.passage}'],
  ['Bookmarks saved cards render SharePassageButton', 'src/client/pages/Bookmarks.tsx', '<SharePassageButton passage={bm.passage}'],
  ['Bookmarks recall/themed review renders SharePassageButton', 'src/client/pages/Bookmarks.tsx', '<SharePassageButton passage={bookmark.passage}'],
  ['History browsing/push cards render SharePassageButton', 'src/client/pages/History.tsx', '<SharePassageButton passage={h.passage}'],
];

let failed = false;
for (const [label, file, needle] of checks) {
  const content = readFileSync(file, 'utf8');
  if (!content.includes(needle)) {
    console.error(`FAIL ${label}: missing ${JSON.stringify(needle)} in ${file}`);
    failed = true;
  } else {
    console.log(`PASS ${label}`);
  }
}
if (failed) process.exit(1);
