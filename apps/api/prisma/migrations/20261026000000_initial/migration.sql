-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SaccoStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLATFORM_ADMIN', 'SACCO_ADMIN', 'RIDER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INVITED');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('MOTORCYCLE', 'MATATU');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "WorkSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecordedSource" AS ENUM ('MOBILE', 'ADMIN');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('FUEL', 'PARKING', 'MAINTENANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('ANDROID_GPS', 'OTHER');

-- CreateTable
CREATE TABLE "Sacco" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "operatingArea" TEXT,
    "status" "SaccoStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sacco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "saccoId" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "saccoId" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "normalizedRegistration" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleAssignment" (
    "id" TEXT NOT NULL,
    "saccoId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "VehicleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSession" (
    "id" TEXT NOT NULL,
    "saccoId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "startLatitude" DECIMAL(9,6),
    "startLongitude" DECIMAL(9,6),
    "endLatitude" DECIMAL(9,6),
    "endLongitude" DECIMAL(9,6),
    "status" "WorkSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "saccoId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "workSessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "startLatitude" DECIMAL(9,6),
    "startLongitude" DECIMAL(9,6),
    "endLatitude" DECIMAL(9,6),
    "endLongitude" DECIMAL(9,6),
    "distanceKm" DECIMAL(10,2),
    "fareAmount" DECIMAL(12,2),
    "status" "TripStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "recordedSource" "RecordedSource" NOT NULL DEFAULT 'MOBILE',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "saccoId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "workSessionId" TEXT,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationUpdate" (
    "id" TEXT NOT NULL,
    "saccoId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "workSessionId" TEXT,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "accuracyMeters" DECIMAL(8,2),
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "LocationSource" NOT NULL DEFAULT 'ANDROID_GPS',
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "LocationUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "saccoId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sacco_registrationNumber_key" ON "Sacco"("registrationNumber");

-- CreateIndex
CREATE INDEX "Sacco_status_name_idx" ON "Sacco"("status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex
CREATE INDEX "User_saccoId_role_status_idx" ON "User"("saccoId", "role", "status");

-- CreateIndex
CREATE INDEX "User_fullName_idx" ON "User"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_saccoId_key" ON "User"("id", "saccoId");

-- CreateIndex
CREATE INDEX "Vehicle_saccoId_type_status_idx" ON "Vehicle"("saccoId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_saccoId_normalizedRegistration_key" ON "Vehicle"("saccoId", "normalizedRegistration");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_id_saccoId_key" ON "Vehicle"("id", "saccoId");

-- CreateIndex
CREATE INDEX "VehicleAssignment_saccoId_status_assignedAt_idx" ON "VehicleAssignment"("saccoId", "status", "assignedAt");

-- CreateIndex
CREATE INDEX "VehicleAssignment_riderId_saccoId_status_idx" ON "VehicleAssignment"("riderId", "saccoId", "status");

-- CreateIndex
CREATE INDEX "VehicleAssignment_vehicleId_saccoId_status_idx" ON "VehicleAssignment"("vehicleId", "saccoId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleAssignment_id_saccoId_riderId_vehicleId_key" ON "VehicleAssignment"("id", "saccoId", "riderId", "vehicleId");

-- CreateIndex
CREATE INDEX "WorkSession_saccoId_status_startedAt_idx" ON "WorkSession"("saccoId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "WorkSession_riderId_saccoId_status_idx" ON "WorkSession"("riderId", "saccoId", "status");

-- CreateIndex
CREATE INDEX "WorkSession_vehicleId_saccoId_status_idx" ON "WorkSession"("vehicleId", "saccoId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSession_id_saccoId_key" ON "WorkSession"("id", "saccoId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSession_id_saccoId_riderId_key" ON "WorkSession"("id", "saccoId", "riderId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSession_id_saccoId_riderId_vehicleId_key" ON "WorkSession"("id", "saccoId", "riderId", "vehicleId");

-- CreateIndex
CREATE INDEX "Trip_saccoId_startedAt_status_idx" ON "Trip"("saccoId", "startedAt", "status");

-- CreateIndex
CREATE INDEX "Trip_riderId_saccoId_startedAt_idx" ON "Trip"("riderId", "saccoId", "startedAt");

-- CreateIndex
CREATE INDEX "Trip_vehicleId_saccoId_startedAt_idx" ON "Trip"("vehicleId", "saccoId", "startedAt");

-- CreateIndex
CREATE INDEX "Trip_workSessionId_saccoId_status_idx" ON "Trip"("workSessionId", "saccoId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_riderId_idempotencyKey_key" ON "Trip"("riderId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Expense_saccoId_recordedAt_category_idx" ON "Expense"("saccoId", "recordedAt", "category");

-- CreateIndex
CREATE INDEX "Expense_riderId_saccoId_recordedAt_idx" ON "Expense"("riderId", "saccoId", "recordedAt");

-- CreateIndex
CREATE INDEX "Expense_workSessionId_saccoId_idx" ON "Expense"("workSessionId", "saccoId");

-- CreateIndex
CREATE INDEX "LocationUpdate_saccoId_vehicleId_recordedAt_idx" ON "LocationUpdate"("saccoId", "vehicleId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "LocationUpdate_saccoId_riderId_recordedAt_idx" ON "LocationUpdate"("saccoId", "riderId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "LocationUpdate_workSessionId_recordedAt_idx" ON "LocationUpdate"("workSessionId", "recordedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "LocationUpdate_riderId_idempotencyKey_key" ON "LocationUpdate"("riderId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AuditLog_saccoId_createdAt_idx" ON "AuditLog"("saccoId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_expiresAt_idx" ON "RefreshToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_key_key" ON "IdempotencyRecord"("userId", "key");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_saccoId_fkey" FOREIGN KEY ("saccoId") REFERENCES "Sacco"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_saccoId_fkey" FOREIGN KEY ("saccoId") REFERENCES "Sacco"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_saccoId_fkey" FOREIGN KEY ("saccoId") REFERENCES "Sacco"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_vehicleId_saccoId_fkey" FOREIGN KEY ("vehicleId", "saccoId") REFERENCES "Vehicle"("id", "saccoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_riderId_saccoId_fkey" FOREIGN KEY ("riderId", "saccoId") REFERENCES "User"("id", "saccoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSession" ADD CONSTRAINT "WorkSession_saccoId_fkey" FOREIGN KEY ("saccoId") REFERENCES "Sacco"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSession" ADD CONSTRAINT "WorkSession_riderId_saccoId_fkey" FOREIGN KEY ("riderId", "saccoId") REFERENCES "User"("id", "saccoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSession" ADD CONSTRAINT "WorkSession_vehicleId_saccoId_fkey" FOREIGN KEY ("vehicleId", "saccoId") REFERENCES "Vehicle"("id", "saccoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSession" ADD CONSTRAINT "WorkSession_assignmentId_saccoId_riderId_vehicleId_fkey" FOREIGN KEY ("assignmentId", "saccoId", "riderId", "vehicleId") REFERENCES "VehicleAssignment"("id", "saccoId", "riderId", "vehicleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_saccoId_fkey" FOREIGN KEY ("saccoId") REFERENCES "Sacco"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_riderId_saccoId_fkey" FOREIGN KEY ("riderId", "saccoId") REFERENCES "User"("id", "saccoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_saccoId_fkey" FOREIGN KEY ("vehicleId", "saccoId") REFERENCES "Vehicle"("id", "saccoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_workSessionId_saccoId_riderId_vehicleId_fkey" FOREIGN KEY ("workSessionId", "saccoId", "riderId", "vehicleId") REFERENCES "WorkSession"("id", "saccoId", "riderId", "vehicleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_saccoId_fkey" FOREIGN KEY ("saccoId") REFERENCES "Sacco"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_riderId_saccoId_fkey" FOREIGN KEY ("riderId", "saccoId") REFERENCES "User"("id", "saccoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_workSessionId_saccoId_riderId_fkey" FOREIGN KEY ("workSessionId", "saccoId", "riderId") REFERENCES "WorkSession"("id", "saccoId", "riderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationUpdate" ADD CONSTRAINT "LocationUpdate_saccoId_fkey" FOREIGN KEY ("saccoId") REFERENCES "Sacco"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationUpdate" ADD CONSTRAINT "LocationUpdate_riderId_saccoId_fkey" FOREIGN KEY ("riderId", "saccoId") REFERENCES "User"("id", "saccoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationUpdate" ADD CONSTRAINT "LocationUpdate_vehicleId_saccoId_fkey" FOREIGN KEY ("vehicleId", "saccoId") REFERENCES "Vehicle"("id", "saccoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationUpdate" ADD CONSTRAINT "LocationUpdate_workSessionId_saccoId_riderId_vehicleId_fkey" FOREIGN KEY ("workSessionId", "saccoId", "riderId", "vehicleId") REFERENCES "WorkSession"("id", "saccoId", "riderId", "vehicleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_saccoId_fkey" FOREIGN KEY ("saccoId") REFERENCES "Sacco"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User"
ADD CONSTRAINT "User_role_sacco_scope_check"
CHECK (
    ("role" = 'PLATFORM_ADMIN' AND "saccoId" IS NULL)
    OR ("role" IN ('SACCO_ADMIN', 'RIDER') AND "saccoId" IS NOT NULL)
);

CREATE UNIQUE INDEX "VehicleAssignment_one_active_per_vehicle"
ON "VehicleAssignment" ("vehicleId")
WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "VehicleAssignment_one_active_per_rider"
ON "VehicleAssignment" ("riderId")
WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "WorkSession_one_active_per_rider"
ON "WorkSession" ("riderId")
WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "Trip_one_in_progress_per_rider"
ON "Trip" ("riderId")
WHERE "status" = 'IN_PROGRESS';

ALTER TABLE "VehicleAssignment"
ADD CONSTRAINT "VehicleAssignment_status_timestamps_check"
CHECK (
    ("status" = 'ACTIVE' AND "unassignedAt" IS NULL)
    OR ("status" = 'ENDED' AND "unassignedAt" IS NOT NULL)
);

ALTER TABLE "WorkSession"
ADD CONSTRAINT "WorkSession_status_timestamps_check"
CHECK (
    ("status" = 'ACTIVE' AND "endedAt" IS NULL)
    OR ("status" IN ('COMPLETED', 'INTERRUPTED') AND "endedAt" IS NOT NULL)
);

ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_status_timestamps_check"
CHECK (
    ("status" = 'IN_PROGRESS' AND "endedAt" IS NULL)
    OR ("status" IN ('COMPLETED', 'CANCELLED') AND "endedAt" IS NOT NULL)
);

ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_nonnegative_financial_and_distance_check"
CHECK (
    ("fareAmount" IS NULL OR "fareAmount" >= 0)
    AND ("distanceKm" IS NULL OR "distanceKm" >= 0)
);

ALTER TABLE "Expense"
ADD CONSTRAINT "Expense_amount_positive_check"
CHECK ("amount" > 0);

ALTER TABLE "LocationUpdate"
ADD CONSTRAINT "LocationUpdate_coordinate_range_check"
CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180);

ALTER TABLE "LocationUpdate"
ADD CONSTRAINT "LocationUpdate_accuracy_nonnegative_check"
CHECK ("accuracyMeters" IS NULL OR "accuracyMeters" >= 0);

ALTER TABLE "WorkSession"
ADD CONSTRAINT "WorkSession_coordinate_pairs_check"
CHECK (
    (("startLatitude" IS NULL AND "startLongitude" IS NULL)
        OR ("startLatitude" IS NOT NULL AND "startLongitude" IS NOT NULL))
    AND (("endLatitude" IS NULL AND "endLongitude" IS NULL)
        OR ("endLatitude" IS NOT NULL AND "endLongitude" IS NOT NULL))
    AND ("startLatitude" IS NULL OR "startLatitude" BETWEEN -90 AND 90)
    AND ("startLongitude" IS NULL OR "startLongitude" BETWEEN -180 AND 180)
    AND ("endLatitude" IS NULL OR "endLatitude" BETWEEN -90 AND 90)
    AND ("endLongitude" IS NULL OR "endLongitude" BETWEEN -180 AND 180)
);

ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_coordinate_pairs_check"
CHECK (
    (("startLatitude" IS NULL AND "startLongitude" IS NULL)
        OR ("startLatitude" IS NOT NULL AND "startLongitude" IS NOT NULL))
    AND (("endLatitude" IS NULL AND "endLongitude" IS NULL)
        OR ("endLatitude" IS NOT NULL AND "endLongitude" IS NOT NULL))
    AND ("startLatitude" IS NULL OR "startLatitude" BETWEEN -90 AND 90)
    AND ("startLongitude" IS NULL OR "startLongitude" BETWEEN -180 AND 180)
    AND ("endLatitude" IS NULL OR "endLatitude" BETWEEN -90 AND 90)
    AND ("endLongitude" IS NULL OR "endLongitude" BETWEEN -180 AND 180)
);
