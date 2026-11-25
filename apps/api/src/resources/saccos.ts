import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  authenticateRequest,
  hashPassword,
  issueEmailVerificationCode,
  requireRoles,
  VerificationRateLimitError,
  type AuthAccount,
  type AuthRepository,
  type AuthenticatedUser,
} from '../auth/auth.js';
import type { EmailSender } from '../email/brevo.js';

export interface ProvisionSaccoInput {
  name: string;
  registrationNumber: string | null;
  phoneNumber: string | null;
  operatingArea: string | null;
  adminFullName: string;
  adminPhoneNumber: string;
  adminEmail: string;
  adminPasswordHash: string;
  actor?: AuthenticatedUser;
}

export interface SaccoSummary {
  id: string;
  name: string;
  registrationNumber: string | null;
  phoneNumber: string | null;
  operatingArea: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: Date;
  administrator: {
    id: string;
    fullName: string;
    phoneNumber: string;
    email: string | null;
  };
}

export interface SaccoRepository {
  listSaccos(limit: number): Promise<SaccoSummary[]>;
  createSacco(input: ProvisionSaccoInput): Promise<SaccoSummary>;
}

const provisionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  registrationNumber: z.preprocess(
    (value) => typeof value === 'string' && !value.trim() ? undefined : value,
    z.string().trim().min(3).max(40).optional(),
  ),
  phoneNumber: z.string().trim().max(20).optional(),
  operatingArea: z.string().trim().max(120).optional(),
  adminFullName: z.string().trim().min(2).max(100),
  adminPhoneNumber: z.string().trim().min(7).max(20),
  adminEmail: z.string().trim().email().max(254),
  adminPassword: z.string().min(14).max(128),
}).strict();

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export function createSaccoRouter(
  authRepository: AuthRepository,
  saccoRepository: SaccoRepository,
  accessTokenSecret: string,
  emailSender: EmailSender,
): Router {
  const router = Router();
  const authenticate = authenticateRequest(authRepository, accessTokenSecret);
  const authorize = requireRoles('PLATFORM_ADMIN');

  router.post('/register', async (request: Request, response: Response) => {
    const input = provisionSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Provide valid SACCO details and an administrator password of at least 14 characters.',
        },
      });
      return;
    }

    const normalized = normalizeProvisionInput(input.data);
    if (!normalized) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Use Kenyan phone numbers and, when provided, a valid SACCO registration number.',
        },
      });
      return;
    }

    try {
      const adminPasswordHash = await hashPassword(input.data.adminPassword);
      const sacco = await saccoRepository.createSacco({
        ...normalized,
        adminPasswordHash,
      });
      if (!await sendAdminVerification(sacco, adminPasswordHash, authRepository, emailSender, accessTokenSecret, response)) return;
      response.status(201).json({
        data: sacco,
        verificationRequired: true,
        message: 'A confirmation code has been sent to the administrator email.',
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        response.status(409).json({
          error: {
            code: 'ALREADY_EXISTS',
            message: 'The SACCO registration, contact, administrator phone number, or email is already in use.',
          },
        });
        return;
      }
      throw error;
    }
  });

  router.get('/', authenticate, authorize, async (request, response) => {
    const query = listSchema.safeParse(request.query);
    if (!query.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'The SACCO list limit must be between 1 and 100.' },
      });
      return;
    }

    const saccos = await saccoRepository.listSaccos(query.data.limit);
    response.status(200).json({ data: saccos });
  });

  router.post('/', authenticate, authorize, async (request: Request, response: Response) => {
    const input = provisionSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Provide valid SACCO details and an administrator password of at least 14 characters.',
        },
      });
      return;
    }

    const normalized = normalizeProvisionInput(input.data);
    if (!normalized) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Use Kenyan phone numbers and, when provided, a valid SACCO registration number.',
        },
      });
      return;
    }

    const actor = request.authenticatedUser;
    if (!actor) {
      response.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'A valid access token is required.' },
      });
      return;
    }

    try {
      const adminPasswordHash = await hashPassword(input.data.adminPassword);
      const sacco = await saccoRepository.createSacco({
        ...normalized,
        adminPasswordHash,
        actor,
      });
      if (!await sendAdminVerification(
        sacco,
        adminPasswordHash,
        authRepository,
        emailSender,
        accessTokenSecret,
        response,
      )) return;
      response.status(201).json({
        data: sacco,
        verificationRequired: true,
        message: 'A confirmation code has been sent to the administrator email.',
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        response.status(409).json({
          error: {
            code: 'ALREADY_EXISTS',
            message: 'The SACCO registration, contact, administrator phone number, or email is already in use.',
          },
        });
        return;
      }
      throw error;
    }
  });

  return router;
}

function normalizeProvisionInput(input: z.infer<typeof provisionSchema>) {
  const adminPhoneNumber = normalizeKenyanPhoneNumber(input.adminPhoneNumber);
  const phoneNumber = input.phoneNumber
    ? normalizeKenyanPhoneNumber(input.phoneNumber)
    : null;
  const registrationNumber = input.registrationNumber
    ?.replace(/[\s-]/g, '')
    .toUpperCase() ?? null;

  if (!adminPhoneNumber
    || (input.phoneNumber && !phoneNumber)
    || (registrationNumber !== null && !/^[A-Z0-9/]{3,40}$/.test(registrationNumber))) {
    return null;
  }

  return {
    name: input.name,
    registrationNumber,
    phoneNumber,
    operatingArea: input.operatingArea || null,
    adminFullName: input.adminFullName,
    adminPhoneNumber,
    adminEmail: input.adminEmail.trim().toLowerCase(),
  };
}

async function sendAdminVerification(
  sacco: SaccoSummary,
  passwordHash: string,
  authRepository: AuthRepository,
  emailSender: EmailSender,
  accessTokenSecret: string,
  response: Response,
): Promise<boolean> {
  const account: AuthAccount = {
    id: sacco.administrator.id,
    fullName: sacco.administrator.fullName,
    phoneNumber: sacco.administrator.phoneNumber,
    email: sacco.administrator.email,
    emailVerifiedAt: null,
    role: 'SACCO_ADMIN',
    saccoId: sacco.id,
    saccoName: sacco.name,
    saccoStatus: sacco.status,
    status: 'ACTIVE',
    passwordHash,
  };
  try {
    await issueEmailVerificationCode(authRepository, emailSender, account, 'EMAIL_VERIFICATION', accessTokenSecret);
    return true;
  } catch (error) {
    const rateLimited = error instanceof VerificationRateLimitError;
    if (!rateLimited) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'SACCO administrator confirmation email delivery failed',
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }));
    }
    response.status(rateLimited ? 429 : 503).json({
      error: {
        code: rateLimited ? 'VERIFICATION_RATE_LIMITED' : 'ACCOUNT_CREATED_EMAIL_FAILED',
        message: 'The SACCO was created, but the administrator confirmation email could not be sent. Request a new code after email delivery is configured.',
      },
    });
    return false;
  }
}

function normalizeKenyanPhoneNumber(value: string): string | null {
  const compact = value.replace(/[\s()-]/g, '');
  if (/^\+254[17]\d{8}$/.test(compact)) return compact;
  if (/^0[17]\d{8}$/.test(compact)) return `+254${compact.slice(1)}`;
  if (/^254[17]\d{8}$/.test(compact)) return `+${compact}`;
  return null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P2002';
}
