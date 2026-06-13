import { readFileSync } from 'node:fs';

const checks = [
  ['component uses Web Speech API', 'src/client/components/ListenControl.tsx', 'SpeechSynthesisUtterance'],
  ['component exposes Listen label', 'src/client/components/ListenControl.tsx', 'Listen'],
  ['component exposes pause state', 'src/client/components/ListenControl.tsx', 'Pause'],
  ['component exposes stop control', 'src/client/components/ListenControl.tsx', 'Stop'],
  ['component handles unsupported browsers', 'src/client/components/ListenControl.tsx', 'not available in this browser'],
  ['Discover passage card renders ListenControl', 'src/client/pages/Discover.tsx', '<ListenControl text={passage.text}'],
  ['Discover daily queue exposes hands-free start action', 'src/client/pages/Discover.tsx', 'Start daily listening'],
  ['Discover daily queue has pause/resume/next/stop controls', 'src/client/pages/Discover.tsx', 'Pause queue'],
  ['Discover daily queue records active passage via existing Discover interaction', 'src/client/pages/Discover.tsx', "fetchPassageById(item.id, 'discover')"],
  ['Bookmarks saved cards render ListenControl', 'src/client/pages/Bookmarks.tsx', '<ListenControl text={bm.passage.text}'],
  ['Bookmarks themed review renders ListenControl', 'src/client/pages/Bookmarks.tsx', '<ListenControl text={bookmark.passage.text}'],
  ['History browsing/push cards render ListenControl', 'src/client/pages/History.tsx', '<ListenControl text={h.passage.text}'],
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
