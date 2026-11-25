CREATE TYPE "VerificationPurpose" AS ENUM ('LOGIN', 'ACTIVATION', 'PASSWORD_CHANGE');

CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VerificationCode_userId_purpose_createdAt_idx"
ON "VerificationCode"("userId", "purpose", "createdAt" DESC);

CREATE INDEX "VerificationCode_expiresAt_idx"
ON "VerificationCode"("expiresAt");

ALTER TABLE "VerificationCode"
ADD CONSTRAINT "VerificationCode_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
