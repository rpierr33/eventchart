-- Schema for eventChart (seating-chart-platform)
-- Run once on fresh DB. Mirrors prisma/schema.prisma.

-- Enums
DO $$ BEGIN
  CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'LIVE', 'ENDED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "WalkInMode" AS ENUM ('AUTO_SEAT', 'REQUIRE_HOST_APPROVAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "LookupPrivacy" AS ENUM ('PUBLIC', 'CODE_PROTECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- User
CREATE TABLE IF NOT EXISTS "User" (
  "id"            TEXT PRIMARY KEY,
  "email"         TEXT NOT NULL UNIQUE,
  "name"          TEXT,
  "passwordHash"  TEXT,
  "emailVerified" TIMESTAMP(3),
  "image"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Account" (
  "id"                 TEXT PRIMARY KEY,
  "userId"             TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "type"               TEXT NOT NULL,
  "provider"           TEXT NOT NULL,
  "providerAccountId"  TEXT NOT NULL,
  "refresh_token"      TEXT,
  "access_token"       TEXT,
  "expires_at"         INTEGER,
  "token_type"         TEXT,
  "scope"              TEXT,
  "id_token"           TEXT,
  "session_state"      TEXT,
  UNIQUE ("provider", "providerAccountId")
);

CREATE TABLE IF NOT EXISTS "Session" (
  "id"           TEXT PRIMARY KEY,
  "sessionToken" TEXT NOT NULL UNIQUE,
  "userId"       TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "expires"      TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "VerificationToken" (
  "identifier" TEXT NOT NULL,
  "token"      TEXT NOT NULL UNIQUE,
  "expires"    TIMESTAMP(3) NOT NULL,
  UNIQUE ("identifier", "token")
);

-- Event
CREATE TABLE IF NOT EXISTS "Event" (
  "id"                    TEXT PRIMARY KEY,
  "hostUserId"            TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "name"                  TEXT NOT NULL,
  "date"                  TIMESTAMP(3),
  "venueName"             TEXT,
  "startsAt"              TIMESTAMP(3),
  "status"                "EventStatus" NOT NULL DEFAULT 'DRAFT',
  "allowWalkIns"          BOOLEAN NOT NULL DEFAULT true,
  "walkInMode"            "WalkInMode" NOT NULL DEFAULT 'REQUIRE_HOST_APPROVAL',
  "lookupPrivacy"         "LookupPrivacy" NOT NULL DEFAULT 'PUBLIC',
  "eventCode"             TEXT,
  "publicSlug"            TEXT NOT NULL UNIQUE,
  "noShowAutoFlagMinutes" INTEGER NOT NULL DEFAULT 45,
  "layoutId"              TEXT UNIQUE,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Event_hostUserId_idx" ON "Event"("hostUserId");

-- Layout
CREATE TABLE IF NOT EXISTS "Layout" (
  "id"                TEXT PRIMARY KEY,
  "name"              TEXT NOT NULL,
  "sourceImageUrl"    TEXT NOT NULL,
  "sourceImageWidth"  INTEGER NOT NULL,
  "sourceImageHeight" INTEGER NOT NULL,
  "isTemplate"        BOOLEAN NOT NULL DEFAULT false,
  "templateName"      TEXT,
  "templateOwnerId"   TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Layout_templateOwnerId_idx" ON "Layout"("templateOwnerId");

-- FK from Event.layoutId → Layout.id (deferred — added after Layout exists)
ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_layoutId_fkey";
ALTER TABLE "Event" ADD CONSTRAINT "Event_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "Layout"("id") ON DELETE SET NULL;

-- Table
CREATE TABLE IF NOT EXISTS "Table" (
  "id"             TEXT PRIMARY KEY,
  "layoutId"       TEXT NOT NULL REFERENCES "Layout"("id") ON DELETE CASCADE,
  "label"          TEXT NOT NULL,
  "capacity"       INTEGER NOT NULL DEFAULT 8,
  "xPct"           DOUBLE PRECISION NOT NULL,
  "yPct"           DOUBLE PRECISION NOT NULL,
  "directionsText" TEXT,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Table_layoutId_idx" ON "Table"("layoutId");

-- Guest (declared before Seat so Seat.assignedGuestId FK works)
CREATE TABLE IF NOT EXISTS "Guest" (
  "id"                   TEXT PRIMARY KEY,
  "eventId"              TEXT NOT NULL REFERENCES "Event"("id") ON DELETE CASCADE,
  "firstName"            TEXT NOT NULL,
  "lastName"             TEXT NOT NULL,
  "assignedTableId"      TEXT REFERENCES "Table"("id") ON DELETE SET NULL,
  "groupTag"             TEXT,
  "plusOneOfGuestId"     TEXT REFERENCES "Guest"("id") ON DELETE SET NULL,
  "isPlusOnePlaceholder" BOOLEAN NOT NULL DEFAULT false,
  "notes"                TEXT,
  "checkedInAt"          TIMESTAMP(3),
  "isWalkIn"             BOOLEAN NOT NULL DEFAULT false,
  "noShowFlaggedAt"      TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Guest_eventId_idx" ON "Guest"("eventId");
CREATE INDEX IF NOT EXISTS "Guest_eventId_lastName_idx" ON "Guest"("eventId", "lastName");
CREATE INDEX IF NOT EXISTS "Guest_assignedTableId_idx" ON "Guest"("assignedTableId");

-- Seat
CREATE TABLE IF NOT EXISTS "Seat" (
  "id"              TEXT PRIMARY KEY,
  "tableId"         TEXT NOT NULL REFERENCES "Table"("id") ON DELETE CASCADE,
  "seatNumber"      INTEGER NOT NULL,
  "assignedGuestId" TEXT UNIQUE REFERENCES "Guest"("id") ON DELETE SET NULL,
  UNIQUE ("tableId", "seatNumber")
);
CREATE INDEX IF NOT EXISTS "Seat_tableId_idx" ON "Seat"("tableId");

-- QRCode
CREATE TABLE IF NOT EXISTS "QRCode" (
  "id"             TEXT PRIMARY KEY,
  "eventId"        TEXT NOT NULL REFERENCES "Event"("id") ON DELETE CASCADE,
  "label"          TEXT NOT NULL,
  "scanOriginXPct" DOUBLE PRECISION,
  "scanOriginYPct" DOUBLE PRECISION,
  "qrImageUrl"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "QRCode_eventId_idx" ON "QRCode"("eventId");

-- WalkInRequest
CREATE TABLE IF NOT EXISTS "WalkInRequest" (
  "id"         TEXT PRIMARY KEY,
  "eventId"    TEXT NOT NULL,
  "firstName"  TEXT NOT NULL,
  "lastName"   TEXT NOT NULL,
  "qrId"       TEXT,
  "status"     TEXT NOT NULL DEFAULT 'PENDING',
  "guestId"    TEXT,
  "notes"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "WalkInRequest_eventId_idx" ON "WalkInRequest"("eventId");
CREATE INDEX IF NOT EXISTS "WalkInRequest_eventId_status_idx" ON "WalkInRequest"("eventId", "status");
