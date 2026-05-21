import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';

const tempDir = mkdtempSync(join(tmpdir(), 'randompage-schema-map-'));
const dbPath = join(tempDir, 'production-shaped.db');
const dbUrl = `file:${dbPath}`;

process.env.LOCAL_DATABASE_URL = dbUrl;
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { PrismaClient } = await import('../src/server/generated/prisma/index.js');
const setup = createClient({ url: dbUrl });
const prisma = new PrismaClient();

async function exec(sql) {
  await setup.execute(sql);
}

try {
  await exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      created_at DATETIME NOT NULL
    )
  `);
  await exec(`
    CREATE TABLE passages (
      id TEXT PRIMARY KEY NOT NULL,
      text TEXT NOT NULL,
      book_title TEXT NOT NULL,
      author TEXT NOT NULL,
      chapter TEXT,
      tags TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en'
    )
  `);
  await exec(`
    CREATE TABLE push_subscriptions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await exec(`
    CREATE TABLE push_history (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      passage_id TEXT NOT NULL,
      sent_at DATETIME NOT NULL,
      read_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await exec(`
    CREATE TABLE browsing_events (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      passage_id TEXT NOT NULL,
      action TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'discover',
      created_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await exec('CREATE INDEX browsing_events_user_created_idx ON browsing_events(user_id, created_at)');
  await exec('CREATE INDEX browsing_events_user_passage_idx ON browsing_events(user_id, passage_id)');
  await exec(`
    CREATE TABLE user_preferences (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);

  const now = new Date();
  const userId = 'schema-smoke-user';
  const passageId = 'schema-smoke-passage';

  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, displayName: 'Reader', createdAt: now },
    update: {},
  });
  await prisma.passage.create({
    data: {
      id: passageId,
      text: 'The map must match the territory.',
      bookTitle: 'Schema Smoke',
      author: 'RandomPage',
      chapter: 'Checks',
      tags: JSON.stringify(['philosophy', 'systems']),
      language: 'en',
    },
  });
  await prisma.pushSubscription.create({
    data: {
      id: 'schema-smoke-subscription',
      userId,
      endpoint: 'https://example.invalid/push/schema-smoke',
      p256dh: 'p256dh',
      auth: 'auth',
      createdAt: now,
    },
  });
  await prisma.pushHistory.create({
    data: { id: 'schema-smoke-push', userId, passageId, sentAt: now },
  });
  await prisma.browsingEvent.create({
    data: {
      id: 'schema-smoke-event',
      userId,
      passageId,
      action: 'view',
      source: 'push_inbox',
      createdAt: now,
    },
  });
  await prisma.userPreference.create({
    data: {
      id: 'schema-smoke-pref',
      userId,
      tag: 'philosophy',
      weight: 2,
      updatedAt: now,
    },
  });

  const [users, subscriptions, events, prefs] = await Promise.all([
    prisma.user.count(),
    prisma.pushSubscription.count({ where: { userId } }),
    prisma.browsingEvent.count({ where: { userId, source: 'push_inbox' } }),
    prisma.userPreference.count({ where: { userId, tag: 'philosophy' } }),
  ]);

  const tableCheck = await setup.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'User') ORDER BY name");
  const tableNames = tableCheck.rows.map(row => row.name);
  if (!tableNames.includes('users') || tableNames.includes('User')) {
    throw new Error(`User model mapped to wrong table(s): ${tableNames.join(', ') || '(none)'}`);
  }
  if (users !== 1 || subscriptions !== 1 || events !== 1 || prefs !== 1) {
    throw new Error(`Unexpected smoke counts users=${users} subscriptions=${subscriptions} events=${events} prefs=${prefs}`);
  }

  console.log('schema table mapping check passed: User maps to users and auth feedback tables write using production-shaped snake_case tables');
} finally {
  await prisma.$disconnect().catch(() => {});
  setup.close();
  rmSync(tempDir, { recursive: true, force: true });
}
