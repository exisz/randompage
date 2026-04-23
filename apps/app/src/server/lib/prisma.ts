import { PrismaClient } from '../generated/prisma/index.js';
import type { PrismaClient as PC } from '../generated/prisma/index.js';
import { PrismaLibSQL } from '@prisma/adapter-libsql';

let singleton: PC | null = null;

export function getPrisma(): PC {
  if (singleton) return singleton;

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (tursoUrl) {
    const adapter = new PrismaLibSQL({ url: tursoUrl, authToken: tursoToken });
    singleton = new PrismaClient({ adapter });
  } else {
    singleton = new PrismaClient();
  }
  return singleton;
}
