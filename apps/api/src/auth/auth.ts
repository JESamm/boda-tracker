import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

const accessTokenLifetimeSeconds = 15 * 60;
const refreshTokenLifetimeMilliseconds = 30 * 24 * 60 * 60 * 1000;
const fakePasswordHash = '$scrypt$16384$8$1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';

export interface AuthenticatedUser {
  id: string;
  fullName: string;
  phoneNumber: string;
  role: 'PLATFORM_ADMIN' | 'SACCO_ADMIN' | 'RIDER';
  saccoId: string | null;
  saccoName: string | null;
}

export interface AuthAccount extends AuthenticatedUser {
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  passwordHash: string;
  saccoStatus: 'ACTIVE' | 'SUSPENDED' | null;
}

export interface RefreshSession {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: AuthAccount;
}

export interface AuthRepository {
  findUserByPhone(phoneNumber: string): Promise<AuthAccount | null>;
  findUserById(userId: string): Promise<AuthAccount | null>;
  findRefreshSession(tokenHash: string): Promise<RefreshSession | null>;
  createRefreshSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  rotateRefreshSession(
    currentId: string,
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<boolean>;
  revokeRefreshSession(tokenHash: string): Promise<void>;
  revokeAllRefreshSessions(userId: string): Promise<void>;
}

interface AccessTokenPayload {
  sub: string;
  role: AuthenticatedUser['role'];
  saccoId: string | null;
  iat: number;
  exp: number;
}

export function createAuthRouter(
  repository: AuthRepository,
  accessTokenSecret: string,
): Router {
  const router = Router();

  router.post('/login', async (request, response) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Enter a valid phone number and password.' },
      });
      return;
    }

    const phoneNumber = normalizePhoneNumber(body.data.phoneNumber);
    const account = phoneNumber
      ? await repository.findUserByPhone(phoneNumber)
      : null;
    const passwordMatches = await verifyPassword(
      body.data.password,
      account?.passwordHash ?? fakePasswordHash,
    );

    if (!account
      || !passwordMatches
      || account.status !== 'ACTIVE'
      || account.saccoStatus === 'SUSPENDED'
      || (account.role !== 'PLATFORM_ADMIN' && !account.saccoId)) {
      response.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Phone number or password is incorrect.' },
      });
      return;
    }

    const refreshToken = createOpaqueToken();
    await repository.createRefreshSession(
      account.id,
      hashToken(refreshToken),
      new Date(Date.now() + refreshTokenLifetimeMilliseconds),
    );

    response.status(200).json({
      accessToken: signAccessToken(account, accessTokenSecret),
      expiresIn: accessTokenLifetimeSeconds,
      refreshToken,
      user: publicUser(account),
    });
  });

  router.post('/refresh', async (request, response) => {
    const body = refreshSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'A refresh token is required.' },
      });
      return;
    }

    const currentTokenHash = hashToken(body.data.refreshToken);
    const session = await repository.findRefreshSession(currentTokenHash);
    if (!session) {
      response.status(401).json({
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'The refresh token is invalid or expired.' },
      });
      return;
    }

    if (session.revokedAt) {
      await repository.revokeAllRefreshSessions(session.userId);
      response.status(401).json({
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'The refresh token is invalid or expired.' },
      });
      return;
    }

    if (session.expiresAt <= new Date() || !isAccountActive(session.user)) {
      await repository.revokeRefreshSession(currentTokenHash);
      response.status(401).json({
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'The refresh token is invalid or expired.' },
      });
      return;
    }

    const refreshToken = createOpaqueToken();
    const rotated = await repository.rotateRefreshSession(
      session.id,
      session.userId,
      hashToken(refreshToken),
      new Date(Date.now() + refreshTokenLifetimeMilliseconds),
    );
    if (!rotated) {
      response.status(401).json({
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'The refresh token is invalid or expired.' },
      });
      return;
    }

    response.status(200).json({
      accessToken: signAccessToken(session.user, accessTokenSecret),
      expiresIn: accessTokenLifetimeSeconds,
      refreshToken,
      user: publicUser(session.user),
    });
  });

  router.post('/logout', async (request, response) => {
    const body = refreshSchema.safeParse(request.body);
    if (!body.success) {
      response.status(204).end();
      return;
    }

    await repository.revokeRefreshSession(hashToken(body.data.refreshToken));
    response.status(204).end();
  });

  router.get('/me', authenticateRequest(repository, accessTokenSecret), (request, response) => {
    response.status(200).json({ user: request.authenticatedUser });
  });

  return router;
}

export function authenticateRequest(repository: AuthRepository, accessTokenSecret: string) {
  return async (request: Request, response: Response, next: (error?: unknown) => void) => {
    const authorization = request.header('authorization');
    const match = authorization?.match(/^Bearer ([^\s]+)$/);
    const token = match?.[1];
    const payload = token ? verifyAccessToken(token, accessTokenSecret) : null;

    if (!payload) {
      response.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'A valid access token is required.' },
      });
      return;
    }

    const account = await repository.findUserById(payload.sub);
    if (!account
      || !isAccountActive(account)
      || account.role !== payload.role
      || account.saccoId !== payload.saccoId) {
      response.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'A valid access token is required.' },
      });
      return;
    }

    request.authenticatedUser = publicUser(account);
    next();
  };
}

export function requireRoles(...roles: AuthenticatedUser['role'][]) {
  return (request: Request, response: Response, next: (error?: unknown) => void) => {
    if (!request.authenticatedUser) {
      response.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'A valid access token is required.' },
      });
      return;
    }

    if (!roles.includes(request.authenticatedUser.role)) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You do not have permission to access this resource.' },
      });
      return;
    }

    next();
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt);
  return `$scrypt$16384$8$1$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: AuthenticatedUser;
    }
  }
}

const loginSchema = z.object({
  phoneNumber: z.string().trim().min(7).max(20),
  password: z.string().min(1).max(128),
}).strict();

const refreshSchema = z.object({
  refreshToken: z.string().min(32).max(256),
}).strict();

function normalizePhoneNumber(value: string): string | null {
  const compact = value.replace(/[\s()-]/g, '');
  if (/^\+254[17]\d{8}$/.test(compact)) return compact;
  if (/^0[17]\d{8}$/.test(compact)) return `+254${compact.slice(1)}`;
  if (/^254[17]\d{8}$/.test(compact)) return `+${compact}`;
  return null;
}

function publicUser(account: AuthAccount): AuthenticatedUser {
  return {
    id: account.id,
    fullName: account.fullName,
    phoneNumber: account.phoneNumber,
    role: account.role,
    saccoId: account.saccoId,
    saccoName: account.saccoName,
  };
}

function isAccountActive(account: AuthAccount): boolean {
  return account.status === 'ACTIVE'
    && account.saccoStatus !== 'SUSPENDED'
    && (account.role === 'PLATFORM_ADMIN' || account.saccoId !== null);
}

function createOpaqueToken(): string {
  return randomBytes(48).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parts = encodedHash.split('$');
  if (parts.length !== 7 || parts[1] !== 'scrypt') {
    await deriveKey(password, Buffer.alloc(16));
    return false;
  }

  const [, , cost, blockSize, parallelization, saltHex, hashHex] = parts;
  if (cost !== '16384'
    || blockSize !== '8'
    || parallelization !== '1'
    || typeof saltHex !== 'string'
    || typeof hashHex !== 'string'
    || !/^[\da-f]{32}$/i.test(saltHex)
    || !/^[\da-f]{64}$/i.test(hashHex)) {
    return false;
  }

  const actual = await deriveKey(password, Buffer.from(saltHex, 'hex'));
  const expected = Buffer.from(hashHex, 'hex');
  return timingSafeEqual(actual, expected);
}

function signAccessToken(account: AuthAccount, secret: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload: AccessTokenPayload = {
    sub: account.id,
    role: account.role,
    saccoId: account.saccoId,
    iat: issuedAt,
    exp: issuedAt + accessTokenLifetimeSeconds,
  };
  const content = `${header}.${encodeJson(payload)}`;
  const signature = createHmac('sha256', secret).update(content).digest('base64url');
  return `${content}.${signature}`;
}

function verifyAccessToken(token: string, secret: string): AccessTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature || !/^[\da-zA-Z_-]+$/.test(signature)) return null;
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const decodedHeader: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    const decodedPayload: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!isHs256Header(decodedHeader) || !isAccessTokenPayload(decodedPayload)) return null;
    if (decodedPayload.exp <= Math.floor(Date.now() / 1000)) return null;
    return decodedPayload;
  } catch {
    return null;
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 32, { N: 16_384, r: 8, p: 1 }, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}

function isHs256Header(value: unknown): value is { alg: 'HS256'; typ: 'JWT' } {
  return typeof value === 'object'
    && value !== null
    && 'alg' in value && value.alg === 'HS256'
    && 'typ' in value && value.typ === 'JWT';
}

function isAccessTokenPayload(value: unknown): value is AccessTokenPayload {
  return typeof value === 'object'
    && value !== null
    && 'sub' in value && typeof value.sub === 'string'
    && 'role' in value && (value.role === 'PLATFORM_ADMIN' || value.role === 'SACCO_ADMIN' || value.role === 'RIDER')
    && 'saccoId' in value && (typeof value.saccoId === 'string' || value.saccoId === null)
    && 'iat' in value && typeof value.iat === 'number'
    && 'exp' in value && typeof value.exp === 'number';
}
