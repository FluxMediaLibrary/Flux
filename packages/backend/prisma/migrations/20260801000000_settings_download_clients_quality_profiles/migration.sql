-- Persist backend-owned server/download/playback/integration settings without
-- changing or deleting the existing notification_settings singleton.
ALTER TABLE "torrents"
    ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "nextRetryAt" TIMESTAMP(3);

CREATE TABLE "server_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "serverName" TEXT NOT NULL,
    "frontendUrl" TEXT NOT NULL,
    "apiUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "language" TEXT NOT NULL DEFAULT 'en',
    "defaultInviteExpiryHours" INTEGER NOT NULL DEFAULT 72,
    "automatedDownloads" BOOLEAN NOT NULL DEFAULT false,
    "preferredProtocol" TEXT NOT NULL DEFAULT 'TORRENT_ONLY',
    "defaultDownloadClientId" TEXT,
    "defaultQualityProfileId" TEXT,
    "automaticSearch" BOOLEAN NOT NULL DEFAULT false,
    "automaticUpgrades" BOOLEAN NOT NULL DEFAULT false,
    "retryFailedDownloads" BOOLEAN NOT NULL DEFAULT true,
    "minimumFreeSpaceGb" INTEGER NOT NULL DEFAULT 10,
    "completedImportBehavior" TEXT NOT NULL DEFAULT 'COPY',
    "torrentSeedRatio" DOUBLE PRECISION,
    "torrentSeedTimeMinutes" INTEGER,
    "torrentRemoveAfterSeeding" BOOLEAN NOT NULL DEFAULT false,
    "usenetRemoveCompleted" BOOLEAN NOT NULL DEFAULT true,
    "usenetRemoveFailed" BOOLEAN NOT NULL DEFAULT false,
    "directPlayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "directStreamEnabled" BOOLEAN NOT NULL DEFAULT true,
    "transcodingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "localBitrateLimitMbps" INTEGER,
    "remoteBitrateLimitMbps" INTEGER,
    "hardwareAcceleration" TEXT NOT NULL DEFAULT 'NONE',
    "preferredAudioLanguage" TEXT,
    "preferredSubtitleLanguage" TEXT,
    "subtitlesMode" TEXT NOT NULL DEFAULT 'FOREIGN_ONLY',
    "autoplayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "resumeBehavior" TEXT NOT NULL DEFAULT 'ASK',
    "skipIntroEnabled" BOOLEAN NOT NULL DEFAULT true,
    "tmdbApiKey" TEXT,
    "downloadClientsSeeded" BOOLEAN NOT NULL DEFAULT false,
    "qualityProfilesSeeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "server_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "download_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "useHttps" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT,
    "credential" TEXT,
    "category" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "download_clients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "download_clients_enabled_priority_idx" ON "download_clients"("enabled", "priority");

CREATE TABLE "quality_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowedResolutions" TEXT[] NOT NULL,
    "sourceTypes" TEXT[] NOT NULL,
    "videoCodecs" TEXT[] NOT NULL,
    "hdrFormats" TEXT[] NOT NULL,
    "audioFormats" TEXT[] NOT NULL,
    "audioChannels" TEXT[] NOT NULL,
    "languages" TEXT[] NOT NULL,
    "releaseGroups" TEXT[] NOT NULL,
    "minimumSizeMb" INTEGER,
    "maximumSizeMb" INTEGER,
    "rules" JSONB NOT NULL,
    "upgradeCutoffScore" INTEGER NOT NULL DEFAULT 100,
    "minimumScoreImprovement" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "quality_profiles_pkey" PRIMARY KEY ("id")
);
