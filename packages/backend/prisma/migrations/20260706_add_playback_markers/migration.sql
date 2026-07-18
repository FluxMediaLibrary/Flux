-- AlterTable
CREATE TYPE "MarkerType" AS ENUM ('INTRO', 'RECAP', 'CREDITS');

-- CreateTable
CREATE TABLE "playback_markers" (
    "id" TEXT NOT NULL,
    "mediaItemId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "markerType" "MarkerType" NOT NULL DEFAULT 'INTRO',
    "startSeconds" DOUBLE PRECISION NOT NULL,
    "endSeconds" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "playback_markers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "playback_markers_mediaItemId_season_markerType_key" ON "playback_markers"("mediaItemId", "season", "markerType");

-- CreateIndex
CREATE INDEX "playback_markers_mediaItemId_idx" ON "playback_markers"("mediaItemId");

-- AddForeignKey
ALTER TABLE "playback_markers" ADD CONSTRAINT "playback_markers_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "media_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
