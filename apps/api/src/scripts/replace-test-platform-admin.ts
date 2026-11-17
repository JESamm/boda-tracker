import { createInterface } from 'node:readline/promises';
import { prisma } from '../db/prisma.js';
import { hashPassword } from '../auth/auth.js';

const expectedAdmin = {
  fullName: 'Boda-Tracker Emulator Test Admin',
  phoneNumber: '+254700000001',
};

async function prompt(question: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await readline.question(question)).trim();
  } finally {
    readline.close();
  }
}

async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Run this command from an interactive terminal so the password can be hidden.');
  }

  process.stdout.write(question);
  process.stdin.setEncoding('utf8');
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onEnd = () => finish(new Error('Password entry canceled.'));
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003' || character === '\u0004') {
          finish(new Error('Password entry canceled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u0008' || character === '\u007f') {
          value = Array.from(value).slice(0, -1).join('');
        } else if (character >= ' ') {
          value += character;
        }
      }
    };

    process.stdin.once('end', onEnd);
    process.stdin.on('data', onData);
  });
}

async function main() {
  const fullName = await prompt('New administrator name: ');
  const phoneNumber = await prompt('New administrator phone (+254...): ');
  const password = await promptHidden('New password (hidden): ');
  const passwordConfirmation = await promptHidden('Confirm password (hidden): ');

  if (fullName.length < 2 || fullName.length > 100) {
    throw new Error('Enter a name between 2 and 100 characters.');
  }
  if (!/^\+254[17]\d{8}$/.test(phoneNumber)) {
    throw new Error('Enter the phone number in Kenyan E.164 format, such as +254712345678.');
  }
  if (password.length < 14 || password.length > 128) {
    throw new Error('Use a unique password between 14 and 128 characters.');
  }
  if (password !== passwordConfirmation) {
    throw new Error('The passwords do not match.');
  }

  const confirmation = await prompt(
    'This only replaces the matching emulator test admin. Type REPLACE TEST ADMIN to continue: ',
  );
  if (confirmation !== 'REPLACE TEST ADMIN') {
    throw new Error('Replacement canceled.');
  }

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(781245630)::text`;
    const admins = await transaction.user.findMany({
      where: { role: 'PLATFORM_ADMIN' },
      select: { id: true, fullName: true, phoneNumber: true },
    });
    const admin = admins[0];
    if (!admin
      || admins.length !== 1
      || admin.fullName !== expectedAdmin.fullName
      || admin.phoneNumber !== expectedAdmin.phoneNumber) {
      throw new Error('The database does not contain exactly the expected emulator test admin; no changes were made.');
    }

    await transaction.user.update({
      where: { id: admin.id },
      data: { fullName, phoneNumber, passwordHash },
    });
    await transaction.refreshToken.updateMany({
      where: { userId: admin.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await transaction.passwordResetToken.updateMany({
      where: { userId: admin.id, usedAt: null },
      data: { usedAt: new Date() },
    });
  });

  console.info('Platform administrator replaced. Store the new login details securely.');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Platform-admin replacement failed.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
