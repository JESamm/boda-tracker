import { createHash, createHmac, randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { SmsSender } from '../sms/africas-talking.js';
import type { EmailCodePurpose, EmailSender } from '../email/brevo.js';

const accessTokenLifetimeSeconds = 15 * 60;
const refreshTokenLifetimeMilliseconds = 30 * 24 * 60 * 60 * 1000;
const fakePasswordHash = '$scrypt$16384$8$1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';

export interface AuthenticatedUser {
  id: string;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  role: 'PLATFORM_ADMIN' | 'SACCO_ADMIN' | 'RIDER';
  saccoId: string | null;
  saccoName: string | null;
}

export interface AuthAccount extends AuthenticatedUser {
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  passwordHash: string;
  saccoStatus: 'ACTIVE' | 'SUSPENDED' | null;
  emailVerifiedAt: Date | null;
}

export interface RefreshSession {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: AuthAccount;
}

export type VerificationPurpose = 'LOGIN' | 'ACTIVATION' | 'PASSWORD_CHANGE' | 'EMAIL_VERIFICATION' | 'EMAIL_LOGIN';

export interface VerificationCodeRecord {
  id: string;
  createdAt: Date;
}

export interface AuthRepository {
  findUserByPhone(phoneNumber: string): Promise<AuthAccount | null>;
  findUserByEmail(email: string): Promise<AuthAccount | null>;
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
  createVerificationCode(input: {
    id: string;
    userId: string;
    purpose: VerificationPurpose;
    codeHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findLatestVerificationCode(userId: string, purpose: VerificationPurpose): Promise<VerificationCodeRecord | null>;
  countRecentVerificationCodes(userId: string, purpose: VerificationPurpose, since: Date): Promise<number>;
  consumeVerificationCode(id: string, codeHash: string, now: Date): Promise<boolean>;
  setUserPassword(userId: string, passwordHash: string, activate: boolean): Promise<void>;
  setUserEmail(userId: string, email: string): Promise<void>;
  markEmailVerified(userId: string, verifiedAt: Date): Promise<void>;
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
  smsSender: SmsSender,
  emailSender: EmailSender,
): Router {
  const router = Router();

  router.post('/login', async (request, response) => {
    const body = z.union([phoneLoginSchema, emailLoginSchema]).safeParse(request.body);
    if (!body.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Enter a valid email address or phone number and password.' },
      });
      return;
    }

    const emailLogin = 'email' in body.data;
    const account = 'email' in body.data
      ? await repository.findUserByEmail(normalizeEmail(body.data.email) ?? '')
      : await repository.findUserByPhone(normalizePhoneNumber(body.data.phoneNumber) ?? '');
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
        error: { code: 'INVALID_CREDENTIALS', message: 'Email/phone number or password is incorrect.' },
      });
      return;
    }

    if (emailLogin) {
      if (!account?.emailVerifiedAt) {
        response.status(403).json({
          error: {
            code: 'EMAIL_NOT_VERIFIED',
            message: 'Confirm your email address before signing in. You can request a new code.',
          },
        });
        return;
      }
      try {
        await issueEmailVerificationCode(repository, emailSender, account, 'EMAIL_LOGIN', accessTokenSecret);
      } catch (error) {
        respondToVerificationError(response, error, 'email');
        return;
      }
      response.status(202).json({
        verificationRequired: true,
        verificationChannel: 'email',
        message: 'A verification code has been sent to your email address.',
      });
      return;
    }

    if (account.role === 'RIDER') {
      try {
        await issueVerificationCode(repository, smsSender, account, 'LOGIN', accessTokenSecret);
      } catch (error) {
        respondToVerificationError(response, error);
        return;
      }
      response.status(202).json({
        verificationRequired: true,
        message: 'A verification code has been sent to your phone.',
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

  router.post('/login/email/verify', async (request, response) => {
    const body = emailVerificationSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Enter your email address and six-digit verification code.' },
      });
      return;
    }
    const email = normalizeEmail(body.data.email);
    const account = email ? await repository.findUserByEmail(email) : null;
    if (!account || !account.emailVerifiedAt || !isAccountActive(account)) {
      invalidVerificationCode(response);
      return;
    }
    const valid = await consumeLatestVerificationCode(
      repository,
      account.id,
      'EMAIL_LOGIN',
      body.data.code,
      accessTokenSecret,
    );
    if (!valid) {
      invalidVerificationCode(response);
      return;
    }
    await issueSession(repository, account, accessTokenSecret, response);
  });

  router.post('/email/verification/request', async (request, response) => {
    const body = emailOnlySchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Enter a valid email address.' },
      });
      return;
    }
    const email = normalizeEmail(body.data.email);
    const account = email ? await repository.findUserByEmail(email) : null;
    if (account && !account.emailVerifiedAt) {
      try {
        await issueEmailVerificationCode(repository, emailSender, account, 'EMAIL_VERIFICATION', accessTokenSecret);
      } catch (error) {
        respondToVerificationError(response, error, 'email');
        return;
      }
    }
    response.status(202).json({
      message: 'If this email has an unverified Boda-Tracker account, a confirmation code has been sent.',
    });
  });

  router.post('/email/add', authenticateRequest(repository, accessTokenSecret), async (request, response) => {
    const body = emailOnlySchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Enter a valid email address.' },
      });
      return;
    }

    const actor = request.authenticatedUser;
    const account = actor ? await repository.findUserById(actor.id) : null;
    const email = normalizeEmail(body.data.email);
    if (!account || !email) {
      response.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'A valid access token is required.' },
      });
      return;
    }
    if (account.email) {
      response.status(409).json({
        error: { code: 'EMAIL_ALREADY_SET', message: 'An email address is already associated with this account.' },
      });
      return;
    }
    const existing = await repository.findUserByEmail(email);
    if (existing && existing.id !== account.id) {
      response.status(409).json({
        error: { code: 'EMAIL_IN_USE', message: 'That email address is already associated with an account.' },
      });
      return;
    }

    try {
      await repository.setUserEmail(account.id, email);
      await issueEmailVerificationCode(
        repository,
        emailSender,
        { ...account, email, emailVerifiedAt: null },
        'EMAIL_VERIFICATION',
        accessTokenSecret,
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        response.status(409).json({
          error: { code: 'EMAIL_IN_USE', message: 'That email address is already associated with an account.' },
        });
        return;
      }
      if (!(error instanceof VerificationRateLimitError)) {
        console.error(JSON.stringify({
          level: 'error',
          message: 'Account email confirmation delivery failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        }));
      }
      response.status(error instanceof VerificationRateLimitError ? 429 : 503).json({
        error: {
          code: error instanceof VerificationRateLimitError ? 'VERIFICATION_RATE_LIMITED' : 'EMAIL_UPDATE_DELIVERY_FAILED',
          message: 'The email address was added, but its confirmation code could not be sent. Request another code shortly.',
        },
      });
      return;
    }

    response.status(202).json({
      message: 'A confirmation code has been sent to the new email address.',
    });
  });

  router.post('/email/verify', async (request, response) => {
    const body = emailVerificationSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Enter your email address and six-digit verification code.' },
      });
      return;
    }
    const email = normalizeEmail(body.data.email);
    const account = email ? await repository.findUserByEmail(email) : null;
    if (!account || account.emailVerifiedAt || !isAccountActive(account)) {
      invalidVerificationCode(response);
      return;
    }
    const valid = await consumeLatestVerificationCode(
      repository,
      account.id,
      'EMAIL_VERIFICATION',
      body.data.code,
      accessTokenSecret,
    );
    if (!valid) {
      invalidVerificationCode(response);
      return;
    }
    await repository.markEmailVerified(account.id, new Date());
    response.status(204).end();
  });

  router.post('/activation/email/complete', async (request, response) => {
    const body = emailActivationSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Enter your email, six-digit code, and a password of at least 14 characters.' },
      });
      return;
    }
    const email = normalizeEmail(body.data.email);
    const account = email ? await repository.findUserByEmail(email) : null;
    if (!account || account.role !== 'RIDER' || account.status !== 'INVITED' || account.emailVerifiedAt) {
      invalidVerificationCode(response);
      return;
    }
    const valid = await consumeLatestVerificationCode(
      repository,
      account.id,
      'EMAIL_VERIFICATION',
      body.data.code,
      accessTokenSecret,
    );
    if (!valid) {
      invalidVerificationCode(response);
      return;
    }
    await repository.markEmailVerified(account.id, new Date());
    await repository.setUserPassword(account.id, await hashPassword(body.data.password), true);
    response.status(204).end();
  });

  router.post('/login/verify', async (request, response) => {
    const body = verificationSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Enter your phone number and six-digit verification code.' },
      });
      return;
    }

    const phoneNumber = normalizePhoneNumber(body.data.phoneNumber);
    const account = phoneNumber ? await repository.findUserByPhone(phoneNumber) : null;
    if (!account || account.role !== 'RIDER' || !isAccountActive(account)) {
      invalidVerificationCode(response);
      return;
    }
    const valid = await consumeLatestVerificationCode(
      repository,
      account.id,
      'LOGIN',
      body.data.code,
      accessTokenSecret,
    );
    if (!valid) {
      invalidVerificationCode(response);
      return;
    }

    await issueSession(repository, account, accessTokenSecret, response);
  });

  router.post('/activation/request', async (request, response) => {
    const body = phoneSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Enter a valid phone number.' },
      });
      return;
    }

    const phoneNumber = normalizePhoneNumber(body.data.phoneNumber);
    const account = phoneNumber ? await repository.findUserByPhone(phoneNumber) : null;
    if (account?.role === 'RIDER' && account.status === 'INVITED') {
      try {
        await issueVerificationCode(repository, smsSender, account, 'ACTIVATION', accessTokenSecret);
      } catch (error) {
        respondToVerificationError(response, error);
        return;
      }
    }
    response.status(202).json({
      message: 'If this phone has an invited rider account, an activation code has been sent.',
    });
  });

  router.post('/activation/complete', async (request, response) => {
    const body = activationSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Enter your phone, six-digit code, and a password of at least 14 characters.' },
      });
      return;
    }
    const phoneNumber = normalizePhoneNumber(body.data.phoneNumber);
    const account = phoneNumber ? await repository.findUserByPhone(phoneNumber) : null;
    if (!account || account.role !== 'RIDER' || account.status !== 'INVITED') {
      invalidVerificationCode(response);
      return;
    }
    const valid = await consumeLatestVerificationCode(
      repository,
      account.id,
      'ACTIVATION',
      body.data.code,
      accessTokenSecret,
    );
    if (!valid) {
      invalidVerificationCode(response);
      return;
    }
    await repository.setUserPassword(account.id, await hashPassword(body.data.password), true);
    response.status(204).end();
  });

  router.post(
    '/password/change/request',
    authenticateRequest(repository, accessTokenSecret),
    async (request, response) => {
      const user = request.authenticatedUser;
      const account = user ? await repository.findUserById(user.id) : null;
      if (!user || !account || user.role !== 'RIDER') {
        response.status(403).json({
          error: { code: 'FORBIDDEN', message: 'Password changes are available for rider accounts.' },
        });
        return;
      }
      try {
        await issueVerificationCode(repository, smsSender, account, 'PASSWORD_CHANGE', accessTokenSecret);
      } catch (error) {
        respondToVerificationError(response, error);
        return;
      }
      response.status(202).json({ message: 'A verification code has been sent to your phone.' });
    },
  );

  router.post(
    '/password/change/complete',
    authenticateRequest(repository, accessTokenSecret),
    async (request, response) => {
      const body = passwordChangeSchema.safeParse(request.body);
      if (!body.success) {
        response.status(400).json({
          error: { code: 'INVALID_REQUEST', message: 'Enter a six-digit verification code and a password of at least 14 characters.' },
        });
        return;
      }
      const user = request.authenticatedUser;
      const account = user ? await repository.findUserById(user.id) : null;
      if (!user || !account || user.role !== 'RIDER') {
        response.status(403).json({
          error: { code: 'FORBIDDEN', message: 'Password changes are available for rider accounts.' },
        });
        return;
      }
      const valid = await consumeLatestVerificationCode(
        repository,
        account.id,
        'PASSWORD_CHANGE',
        body.data.code,
        accessTokenSecret,
      );
      if (!valid) {
        invalidVerificationCode(response);
        return;
      }
      await repository.setUserPassword(account.id, await hashPassword(body.data.password), false);
      await repository.revokeAllRefreshSessions(account.id);
      response.status(204).end();
    },
  );

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

const phoneLoginSchema = z.object({
  phoneNumber: z.string().trim().min(7).max(20),
  password: z.string().min(1).max(128),
}).strict();

const emailLoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict();

const refreshSchema = z.object({
  refreshToken: z.string().min(32).max(256),
}).strict();

const phoneSchema = z.object({
  phoneNumber: z.string().trim().min(7).max(20),
}).strict();

const verificationSchema = phoneSchema.extend({
  code: z.string().regex(/^\d{6}$/),
}).strict();

const emailOnlySchema = z.object({
  email: z.string().trim().email().max(254),
}).strict();

const emailVerificationSchema = emailOnlySchema.extend({
  code: z.string().regex(/^\d{6}$/),
}).strict();

const emailActivationSchema = emailVerificationSchema.extend({
  password: z.string().min(14).max(128),
}).strict();

const activationSchema = verificationSchema.extend({
  password: z.string().min(14).max(128),
}).strict();

const passwordChangeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(14).max(128),
}).strict();

const verificationCodeLifetimeMilliseconds = 10 * 60 * 1000;
export class VerificationRateLimitError extends Error {}

export async function issueVerificationCode(
  repository: AuthRepository,
  smsSender: SmsSender,
  account: AuthAccount,
  purpose: VerificationPurpose,
  secret: string,
): Promise<void> {
  const { code } = await createVerificationCode(repository, account, purpose, secret);
  await smsSender.send(
    account.phoneNumber,
    `Boda-Tracker ${verificationMessageLabel(purpose)} code: ${code}. It expires in 10 minutes. Never share this code.`,
  );
}

export async function issueEmailVerificationCode(
  repository: AuthRepository,
  emailSender: EmailSender,
  account: AuthAccount,
  purpose: 'EMAIL_VERIFICATION' | 'EMAIL_LOGIN',
  secret: string,
): Promise<void> {
  if (!account.email) throw new Error('The account has no email address for verification.');
  const { code } = await createVerificationCode(repository, account, purpose, secret);
  const emailPurpose: EmailCodePurpose = purpose === 'EMAIL_VERIFICATION'
    ? account.status === 'INVITED' ? 'activation' : 'signup'
    : 'login';
  await emailSender.sendVerificationCode(account.email, code, emailPurpose);
}

async function createVerificationCode(
  repository: AuthRepository,
  account: AuthAccount,
  purpose: VerificationPurpose,
  secret: string,
): Promise<{ code: string }> {
  const now = new Date();
  const latest = await repository.findLatestVerificationCode(account.id, purpose);
  if (latest && now.getTime() - latest.createdAt.getTime() < 60_000) {
    throw new VerificationRateLimitError();
  }
  const sentRecently = await repository.countRecentVerificationCodes(
    account.id,
    purpose,
    new Date(now.getTime() - 60 * 60 * 1000),
  );
  if (sentRecently >= 5) throw new VerificationRateLimitError();
  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await repository.createVerificationCode({
    id,
    userId: account.id,
    purpose,
    codeHash: hashVerificationCode(id, code, secret),
    expiresAt: new Date(now.getTime() + verificationCodeLifetimeMilliseconds),
  });
  return { code };
}

function verificationMessageLabel(purpose: VerificationPurpose): string {
  if (purpose === 'ACTIVATION') return 'account activation';
  if (purpose === 'PASSWORD_CHANGE') return 'password change';
  return 'sign-in verification';
}

async function consumeLatestVerificationCode(
  repository: AuthRepository,
  userId: string,
  purpose: VerificationPurpose,
  code: string,
  secret: string,
): Promise<boolean> {
  const latest = await repository.findLatestVerificationCode(userId, purpose);
  if (!latest) return false;
  return repository.consumeVerificationCode(
    latest.id,
    hashVerificationCode(latest.id, code, secret),
    new Date(),
  );
}

function hashVerificationCode(id: string, code: string, secret: string): string {
  return createHmac('sha256', secret).update(`${id}:${code}`).digest('hex');
}

async function issueSession(
  repository: AuthRepository,
  account: AuthAccount,
  accessTokenSecret: string,
  response: Response,
): Promise<void> {
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
}

export function respondToVerificationError(
  response: Response,
  error: unknown,
  channel: 'sms' | 'email' = 'sms',
): void {
  if (error instanceof VerificationRateLimitError) {
    response.status(429).json({
      error: { code: 'VERIFICATION_RATE_LIMITED', message: 'Please wait before requesting another verification code.' },
    });
    return;
  }
  console.error(JSON.stringify({
    level: 'error',
    message: `Verification ${channel} delivery failed`,
    errorType: error instanceof Error ? error.name : 'UnknownError',
  }));
  response.status(503).json({
    error: {
      code: channel === 'email' ? 'EMAIL_UNAVAILABLE' : 'SMS_UNAVAILABLE',
      message: `The verification ${channel} could not be sent. Please try again later.`,
    },
  });
}

function invalidVerificationCode(response: Response): void {
  response.status(401).json({
    error: { code: 'INVALID_VERIFICATION_CODE', message: 'The verification code is invalid or expired.' },
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P2002';
}

function normalizePhoneNumber(value: string): string | null {
  const compact = value.replace(/[\s()-]/g, '');
  if (/^\+254[17]\d{8}$/.test(compact)) return compact;
  if (/^0[17]\d{8}$/.test(compact)) return `+254${compact.slice(1)}`;
  if (/^254[17]\d{8}$/.test(compact)) return `+${compact}`;
  return null;
}

function publicUser(account: AuthAccount): AuthenticatedUser & { emailVerified: boolean } {
  return {
    id: account.id,
    fullName: account.fullName,
    phoneNumber: account.phoneNumber,
    email: account.email,
    emailVerified: account.emailVerifiedAt !== null,
    role: account.role,
    saccoId: account.saccoId,
    saccoName: account.saccoName,
  };
}

function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return z.string().email().max(254).safeParse(normalized).success ? normalized : null;
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
