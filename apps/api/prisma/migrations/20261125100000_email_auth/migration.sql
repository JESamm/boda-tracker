ALTER TYPE "VerificationPurpose" ADD VALUE 'EMAIL_VERIFICATION';
ALTER TYPE "VerificationPurpose" ADD VALUE 'EMAIL_LOGIN';

ALTER TABLE "User"
ADD COLUMN "email" TEXT,
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
