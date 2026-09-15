-- Storage placement policy + first-run setup state on the settings singleton.
-- Additive only; existing rows pick up defaults. Installs that already have
-- users are marked setupCompleted by the backend at boot (see setup.service).
ALTER TABLE "server_settings"
    ADD COLUMN "storagePlacementStrategy" TEXT NOT NULL DEFAULT 'MOST_FREE',
    ADD COLUMN "preferredMediaRoot" TEXT,
    ADD COLUMN "setupCompleted" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "setupCompletedAt" TIMESTAMP(3);

UPDATE "server_settings"
SET "setupCompleted" = true, "setupCompletedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "users");
