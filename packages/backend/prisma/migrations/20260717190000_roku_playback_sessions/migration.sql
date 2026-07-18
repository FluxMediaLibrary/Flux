CREATE TABLE "playback_sessions" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "deviceSessionId" TEXT NOT NULL,
  "mediaItemId" TEXT NOT NULL,
  "episodeId" TEXT,
  "method" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "audioStreamIndex" INTEGER,
  "subtitleStreamIndex" INTEGER,
  "positionSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "durationSeconds" DOUBLE PRECISION,
  "state" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "playback_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "playback_sessions_deviceSessionId_state_idx" ON "playback_sessions"("deviceSessionId", "state");
CREATE INDEX "playback_sessions_profileId_updatedAt_idx" ON "playback_sessions"("profileId", "updatedAt");
CREATE INDEX "playback_sessions_expiresAt_idx" ON "playback_sessions"("expiresAt");

ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_deviceSessionId_fkey" FOREIGN KEY ("deviceSessionId") REFERENCES "device_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "media_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
