ALTER TABLE "server_settings"
    ADD COLUMN "createMediaTypeSubfolders" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "moviesDirectory" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "tvDirectory" TEXT NOT NULL DEFAULT '';
