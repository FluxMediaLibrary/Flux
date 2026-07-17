ALTER TABLE "users"
ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requestLimit" INTEGER,
ADD COLUMN "streamLimit" INTEGER;

CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt");
CREATE INDEX "audit_events_actorId_idx" ON "audit_events"("actorId");
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
