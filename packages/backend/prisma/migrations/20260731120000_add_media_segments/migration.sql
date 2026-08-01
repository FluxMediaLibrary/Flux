-- Media segments: reusable episode markers (intro/recap/credits/preview) with
-- millisecond timestamps, confidence, and provenance (automatic vs manual).
-- Automatic rescans must never overwrite MANUAL segments unless explicitly
-- requested (force), so the job deletes only AUTOMATIC rows per episode.
BEGIN;

CREATE TYPE "MediaSegmentType" AS ENUM ('INTRO', 'RECAP', 'CREDITS', 'PREVIEW');
CREATE TYPE "MediaSegmentSource" AS ENUM ('AUTOMATIC', 'MANUAL');

CREATE TABLE "media_segments" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "type" "MediaSegmentType" NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "source" "MediaSegmentSource" NOT NULL DEFAULT 'AUTOMATIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_segments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_segments_range_check"
      CHECK ("startMs" >= 0 AND "endMs" > "startMs")
);

CREATE INDEX "media_segments_episodeId_type_idx" ON "media_segments"("episodeId", "type");

ALTER TABLE "media_segments"
  ADD CONSTRAINT "media_segments_episodeId_fkey"
  FOREIGN KEY ("episodeId") REFERENCES "episodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
