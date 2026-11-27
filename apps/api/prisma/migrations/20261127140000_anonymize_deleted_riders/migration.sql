ALTER TABLE "User"
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "User_saccoId_role_deletedAt_idx"
ON "User"("saccoId", "role", "deletedAt");
