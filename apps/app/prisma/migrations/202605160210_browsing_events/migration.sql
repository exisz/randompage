CREATE TABLE IF NOT EXISTS "browsing_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "passage_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'discover',
  "created_at" DATETIME NOT NULL,
  CONSTRAINT "browsing_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "browsing_events_passage_id_fkey" FOREIGN KEY ("passage_id") REFERENCES "passages" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "browsing_events_user_created_idx" ON "browsing_events"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "browsing_events_user_passage_idx" ON "browsing_events"("user_id", "passage_id");
