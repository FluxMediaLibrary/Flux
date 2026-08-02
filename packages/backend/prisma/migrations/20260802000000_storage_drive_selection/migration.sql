ALTER TABLE "server_settings"
  ADD COLUMN "primaryMediaRoot" TEXT,
  ADD COLUMN "managedMediaRoots" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "storageReserveGb" INTEGER NOT NULL DEFAULT 20;
