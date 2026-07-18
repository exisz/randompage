import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function expect(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}

const serverApp = read('src/server/app.ts');
const playlistRoute = read('src/server/routes/playlists.ts');
const main = read('src/client/main.tsx');
const bookmarks = read('src/client/pages/Bookmarks.tsx');
const playlist = read('src/client/pages/Playlist.tsx');

expect('server mounts playlists router', serverApp.includes('playlistsRouter'));
expect('share tables persist read-only tokens', playlistRoute.includes('passage_playlist_shares') && playlistRoute.includes('passage_playlist_share_items'));
expect('create endpoint requires auth', playlistRoute.includes("playlistsRouter.post('/playlists'") && playlistRoute.includes('verifyBearer'));
expect('public endpoint is unauthenticated read-only', playlistRoute.includes("playlistsRouter.get('/playlists/:shareId'") && playlistRoute.includes('JOIN passages'));
expect('create endpoint stores passage IDs only', playlistRoute.includes('passage_id') && !playlistRoute.includes('summary'));
expect('client route renders /playlist/:shareId', main.includes('path="/playlist/:shareId"'));
expect('Bookmarks My Queue exposes Share playlist', bookmarks.includes('Share playlist') && bookmarks.includes("apiFetch('/playlists'"));
expect('public playlist page has sign-in/save CTA and no social UI controls', playlist.includes('Sign in to save') && playlist.includes('Save') && !/CommentButton|FollowButton|LikeButton|commentsRouter|followers/i.test(playlist));
expect('playlist page reuses passage actions', playlist.includes('ListenControl') && playlist.includes('SharePassageButton') && playlist.includes('SharePassageImageButton'));

const failed = checks.filter(check => !check.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
if (failed.length) {
  console.error(`\n${failed.length} playlist-share policy check(s) failed.`);
  process.exit(1);
}
console.log('\nplaylist-share policy checks passed');
