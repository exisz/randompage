import { readFileSync } from 'node:fs';

const checks = [
  ['component uses Web Speech API', 'src/client/components/ListenControl.tsx', 'SpeechSynthesisUtterance'],
  ['component exposes Listen label', 'src/client/components/ListenControl.tsx', 'Listen'],
  ['component exposes pause state', 'src/client/components/ListenControl.tsx', 'Pause'],
  ['component exposes stop control', 'src/client/components/ListenControl.tsx', 'Stop'],
  ['component handles unsupported browsers', 'src/client/components/ListenControl.tsx', 'not available in this browser'],
  ['Media Session helper sets passage metadata', 'src/client/lib/mediaSession.ts', 'navigator.mediaSession.metadata = new MediaMetadata'],
  ['Media Session helper registers lock-screen handlers', 'src/client/lib/mediaSession.ts', 'setActionHandler(action'],
  ['ListenControl integrates Media Session metadata', 'src/client/components/ListenControl.tsx', 'setPassageMediaSession'],
  ['ListenControl clears Media Session on stop/end', 'src/client/components/ListenControl.tsx', 'clearPassageMediaSession'],
  ['Discover passage card renders ListenControl', 'src/client/pages/Discover.tsx', '<ListenControl text={passage.text}'],

  ['Discover daily queue exposes hands-free start action', 'src/client/pages/Discover.tsx', 'Start daily listening'],
  ['Discover daily queue has pause/resume/next/stop controls', 'src/client/pages/Discover.tsx', 'Pause queue'],
  ['Discover daily queue records active passage via existing Discover interaction', 'src/client/pages/Discover.tsx', "fetchPassageById(item.id, 'discover')"],
  ['Discover daily queue tracks speech boundary events', 'src/client/pages/Discover.tsx', 'utterance.onboundary'],
  ['Discover daily queue sets Media Session metadata', 'src/client/pages/Discover.tsx', 'RandomPage Daily Listening'],
  ['Discover daily queue wires lock-screen next handler', 'src/client/pages/Discover.tsx', 'nexttrack'],
  ['Discover daily queue highlights active spoken chunk', 'src/client/pages/Discover.tsx', 'data-speaking-chunk'],
  ['Discover daily queue surfaces listening highlight copy', 'src/client/pages/Discover.tsx', 'Listening highlight'],
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
