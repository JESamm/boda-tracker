import { prisma } from '../db/prisma.js';
import { hashPassword } from '../auth/auth.js';

const fullName = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
const phoneNumber = process.env.BOOTSTRAP_ADMIN_PHONE?.trim();
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

async function main() {
  if (!fullName || fullName.length < 2 || fullName.length > 100) {
    throw new BootstrapInputError('Set BOOTSTRAP_ADMIN_NAME to a name between 2 and 100 characters.');
  }
  if (!phoneNumber || !/^\+254[17]\d{8}$/.test(phoneNumber)) {
    throw new BootstrapInputError('Set BOOTSTRAP_ADMIN_PHONE in Kenyan E.164 format, for example +254712345678.');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new BootstrapInputError('Set BOOTSTRAP_ADMIN_EMAIL to a valid administrator email address.');
  }
  if (!password || password.length < 14 || password.length > 128) {
    throw new BootstrapInputError('Set BOOTSTRAP_ADMIN_PASSWORD to a unique password between 14 and 128 characters.');
  }

  const passwordHash = await hashPassword(password);
  const created = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(781245630)::text`;
    const existingAdmins = await transaction.user.count({
      where: { role: 'PLATFORM_ADMIN' },
    });
    if (existingAdmins > 0) return false;

    await transaction.user.create({
      data: {
        fullName,
        phoneNumber,
        email,
        emailVerifiedAt: new Date(),
        passwordHash,
        role: 'PLATFORM_ADMIN',
        status: 'ACTIVE',
      },
    });
    return true;
  });

  if (!created) {
    throw new BootstrapInputError('A platform administrator already exists; bootstrap can only run once.');
  }
  console.info('Platform administrator created. Remove the bootstrap credentials from the environment.');
}

main()
  .catch((error: unknown) => {
    if (error instanceof BootstrapInputError) {
      console.error(error.message);
    } else {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Platform administrator bootstrap failed.',
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorCode: typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined,
        errorMessage: error instanceof Error ? error.message : undefined,
      }));
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

class BootstrapInputError extends Error {}
