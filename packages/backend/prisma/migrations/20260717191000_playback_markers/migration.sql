CREATE TABLE "playback_markers" (
  "id" TEXT NOT NULL,
  "mediaItemId" TEXT,
  "episodeId" TEXT,
  "type" TEXT NOT NULL,
  "startSeconds" DOUBLE PRECISION NOT NULL,
  "endSeconds" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "playback_markers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "playback_markers_target_check" CHECK (("mediaItemId" IS NOT NULL AND "episodeId" IS NULL) OR ("mediaItemId" IS NULL AND "episodeId" IS NOT NULL)),
  CONSTRAINT "playback_markers_range_check" CHECK ("startSeconds" >= 0 AND "endSeconds" > "startSeconds")
);

CREATE INDEX "playback_markers_mediaItemId_type_idx" ON "playback_markers"("mediaItemId", "type");
CREATE INDEX "playback_markers_episodeId_type_idx" ON "playback_markers"("episodeId", "type");
ALTER TABLE "playback_markers" ADD CONSTRAINT "playback_markers_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "media_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "playback_markers" ADD CONSTRAINT "playback_markers_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
