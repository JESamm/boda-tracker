import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { loadEnv } from '../config/env.js';

const { DATABASE_URL } = loadEnv();
const adapter = new PrismaPg({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
});

export const prisma = new PrismaClient({ adapter });
