-- Playback markers originally shipped in 20260706_add_playback_markers. Keep
-- that migration in history and evolve its table instead of creating it again.
BEGIN;

ALTER TABLE "playback_markers" RENAME COLUMN "markerType" TO "type";
ALTER TABLE "playback_markers" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "playback_markers" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;
UPDATE "playback_markers" SET "type" = LOWER("type");
ALTER TABLE "playback_markers" ADD COLUMN "episodeId" TEXT;
ALTER TABLE "playback_markers" ALTER COLUMN "mediaItemId" DROP NOT NULL;

DROP INDEX "playback_markers_mediaItemId_season_markerType_key";
DROP INDEX "playback_markers_mediaItemId_idx";

ALTER TABLE "playback_markers" DROP COLUMN "season";
ALTER TABLE "playback_markers" DROP COLUMN "confidence";

DELETE FROM "playback_markers"
WHERE "startSeconds" < 0 OR "endSeconds" <= "startSeconds";

ALTER TABLE "playback_markers"
  ADD CONSTRAINT "playback_markers_target_check"
  CHECK (("mediaItemId" IS NOT NULL AND "episodeId" IS NULL) OR ("mediaItemId" IS NULL AND "episodeId" IS NOT NULL));
ALTER TABLE "playback_markers"
  ADD CONSTRAINT "playback_markers_range_check"
  CHECK ("startSeconds" >= 0 AND "endSeconds" > "startSeconds");

CREATE INDEX "playback_markers_mediaItemId_type_idx" ON "playback_markers"("mediaItemId", "type");
CREATE INDEX "playback_markers_episodeId_type_idx" ON "playback_markers"("episodeId", "type");
ALTER TABLE "playback_markers" ADD CONSTRAINT "playback_markers_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TYPE "MarkerType";

COMMIT;
