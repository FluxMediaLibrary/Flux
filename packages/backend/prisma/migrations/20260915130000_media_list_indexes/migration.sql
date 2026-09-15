-- Library grid sorts by title and the home page by addedAt; both were
-- sequential scans on large libraries.
CREATE INDEX IF NOT EXISTS "media_items_addedAt_idx" ON "media_items"("addedAt");
CREATE INDEX IF NOT EXISTS "media_items_title_idx" ON "media_items"("title");
