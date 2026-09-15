-- Re-introduce device link (TV clients) and server-side playback sessions.
-- These tables were dropped by 20260729164000_remove_roku_support; the Roku
-- client is back, so recreate them (IF NOT EXISTS keeps this idempotent for
-- databases that never ran the drop).
CREATE TABLE IF NOT EXISTS "device_authorizations" (
    "id" TEXT NOT NULL,
    "deviceCodeHash" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pollIntervalSeconds" INTEGER NOT NULL DEFAULT 5,
    "lastPolledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "device_authorizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "device_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "refreshVersion" INTEGER NOT NULL DEFAULT 1,
    "activeProfileId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "playback_sessions" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "device_authorizations_deviceCodeHash_key" ON "device_authorizations"("deviceCodeHash");
CREATE UNIQUE INDEX IF NOT EXISTS "device_authorizations_userCode_key" ON "device_authorizations"("userCode");
CREATE INDEX IF NOT EXISTS "device_authorizations_expiresAt_idx" ON "device_authorizations"("expiresAt");
CREATE INDEX IF NOT EXISTS "device_authorizations_approvedById_idx" ON "device_authorizations"("approvedById");
CREATE UNIQUE INDEX IF NOT EXISTS "device_sessions_refreshTokenHash_key" ON "device_sessions"("refreshTokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "device_sessions_userId_deviceId_key" ON "device_sessions"("userId", "deviceId");
CREATE INDEX IF NOT EXISTS "device_sessions_expiresAt_idx" ON "device_sessions"("expiresAt");
CREATE INDEX IF NOT EXISTS "device_sessions_userId_revokedAt_idx" ON "device_sessions"("userId", "revokedAt");
CREATE INDEX IF NOT EXISTS "playback_sessions_deviceSessionId_state_idx" ON "playback_sessions"("deviceSessionId", "state");
CREATE INDEX IF NOT EXISTS "playback_sessions_profileId_updatedAt_idx" ON "playback_sessions"("profileId", "updatedAt");
CREATE INDEX IF NOT EXISTS "playback_sessions_expiresAt_idx" ON "playback_sessions"("expiresAt");

DO $$ BEGIN
  ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_deviceSessionId_fkey" FOREIGN KEY ("deviceSessionId") REFERENCES "device_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "media_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
