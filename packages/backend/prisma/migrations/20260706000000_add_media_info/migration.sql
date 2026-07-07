-- CreateTable
CREATE TABLE "media_streams" (
    "id" TEXT NOT NULL,
    "mediaItemId" TEXT,
    "episodeId" TEXT,
    "type" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "codec" TEXT,
    "profile" TEXT,
    "level" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "bitrate" INTEGER,
    "framerate" DOUBLE PRECISION,
    "hdr" TEXT,
    "channels" INTEGER,
    "language" TEXT,
    "title" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isForced" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "media_streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_info" (
    "id" TEXT NOT NULL,
    "mediaItemId" TEXT,
    "episodeId" TEXT,
    "container" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "hasVideo" BOOLEAN NOT NULL,
    "hasAudio" BOOLEAN NOT NULL,
    "hasSubtitles" BOOLEAN NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_info_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_streams_mediaItemId_idx" ON "media_streams"("mediaItemId");

-- CreateIndex
CREATE INDEX "media_streams_episodeId_idx" ON "media_streams"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "media_info_mediaItemId_key" ON "media_info"("mediaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "media_info_episodeId_key" ON "media_info"("episodeId");

-- CreateIndex
CREATE INDEX "media_info_mediaItemId_idx" ON "media_info"("mediaItemId");

-- CreateIndex
CREATE INDEX "media_info_episodeId_idx" ON "media_info"("episodeId");

-- AddForeignKey
ALTER TABLE "media_streams" ADD CONSTRAINT "media_streams_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "media_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_streams" ADD CONSTRAINT "media_streams_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_info" ADD CONSTRAINT "media_info_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "media_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_info" ADD CONSTRAINT "media_info_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
