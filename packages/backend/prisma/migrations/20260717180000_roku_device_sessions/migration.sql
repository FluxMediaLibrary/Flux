CREATE TABLE "device_authorizations" (
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "device_authorizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "device_sessions" (
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

CREATE UNIQUE INDEX "device_authorizations_deviceCodeHash_key" ON "device_authorizations"("deviceCodeHash");
CREATE UNIQUE INDEX "device_authorizations_userCode_key" ON "device_authorizations"("userCode");
CREATE INDEX "device_authorizations_expiresAt_idx" ON "device_authorizations"("expiresAt");
CREATE INDEX "device_authorizations_approvedById_idx" ON "device_authorizations"("approvedById");
CREATE UNIQUE INDEX "device_sessions_refreshTokenHash_key" ON "device_sessions"("refreshTokenHash");
CREATE UNIQUE INDEX "device_sessions_userId_deviceId_key" ON "device_sessions"("userId", "deviceId");
CREATE INDEX "device_sessions_expiresAt_idx" ON "device_sessions"("expiresAt");
CREATE INDEX "device_sessions_userId_revokedAt_idx" ON "device_sessions"("userId", "revokedAt");
ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
