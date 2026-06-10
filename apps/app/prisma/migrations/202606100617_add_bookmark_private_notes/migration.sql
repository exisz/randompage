-- Add optional per-user private notes to saved passages.
ALTER TABLE bookmarks ADD COLUMN note TEXT;
