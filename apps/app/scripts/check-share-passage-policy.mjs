import { readFileSync } from 'node:fs';

const checks = [
  ['share component uses Web Share API', 'src/client/components/SharePassageButton.tsx', 'navigator.share'],
  ['share component falls back to clipboard', 'src/client/components/SharePassageButton.tsx', 'navigator.clipboard.writeText'],
  ['share text includes RandomPage URL', 'src/client/components/SharePassageButton.tsx', 'Read it on RandomPage'],
  ['share URL targets exact passage', 'src/client/components/SharePassageButton.tsx', '/discover?passageId='],
  ['image card component renders client canvas', 'src/client/components/SharePassageImageButton.tsx', "document.createElement('canvas')"],
  ['image card shares files when supported', 'src/client/components/SharePassageImageButton.tsx', 'navigator.canShare'],
  ['image card falls back to download', 'src/client/components/SharePassageImageButton.tsx', 'downloadBlob'],
  ['image card includes RandomPage branding', 'src/client/components/SharePassageImageButton.tsx', 'RANDOMPAGE'],
  ['image card URL targets exact passage', 'src/client/components/SharePassageImageButton.tsx', '/discover?passageId='],
  ['Discover current card renders SharePassageButton', 'src/client/pages/Discover.tsx', '<SharePassageButton passage={passage}'],
  ['Discover current card renders SharePassageImageButton', 'src/client/pages/Discover.tsx', '<SharePassageImageButton passage={passage}'],
  ['Discover Daily Review renders SharePassageButton', 'src/client/pages/Discover.tsx', '<SharePassageButton passage={item.passage}'],
  ['Discover Daily Review renders SharePassageImageButton', 'src/client/pages/Discover.tsx', '<SharePassageImageButton passage={item.passage}'],
  ['Bookmarks saved cards render SharePassageButton', 'src/client/pages/Bookmarks.tsx', '<SharePassageButton passage={bm.passage}'],
  ['Bookmarks saved cards render SharePassageImageButton', 'src/client/pages/Bookmarks.tsx', '<SharePassageImageButton passage={bm.passage}'],
  ['Bookmarks recall/themed review renders SharePassageButton', 'src/client/pages/Bookmarks.tsx', '<SharePassageButton passage={bookmark.passage}'],
  ['Bookmarks recall/themed review renders SharePassageImageButton', 'src/client/pages/Bookmarks.tsx', '<SharePassageImageButton passage={bookmark.passage}'],
  ['History browsing/push cards render SharePassageButton', 'src/client/pages/History.tsx', '<SharePassageButton passage={h.passage}'],
  ['History browsing/push cards render SharePassageImageButton', 'src/client/pages/History.tsx', '<SharePassageImageButton passage={h.passage}'],
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
