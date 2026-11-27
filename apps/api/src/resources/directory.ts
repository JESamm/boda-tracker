import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  authenticateRequest,
  hashPassword,
  issueEmailVerificationCode,
  requireRoles,
  VerificationRateLimitError,
  type AuthAccount,
  type AuthRepository,
} from '../auth/auth.js';
import type { EmailSender } from '../email/brevo.js';

export interface RiderSummary {
  id: string;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  createdAt: Date;
}

export interface VehicleSummary {
  id: string;
  registrationNumber: string;
  type: 'MOTORCYCLE' | 'MATATU';
  status: 'ACTIVE' | 'SUSPENDED' | 'MAINTENANCE' | 'RETIRED';
  createdAt: Date;
}

export interface DirectoryPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface CreateRiderInput {
  fullName: string;
  phoneNumber: string;
  email: string;
  passwordHash: string;
  saccoId: string;
  actorUserId: string;
}

export interface UpdateRiderInput {
  riderId: string;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  saccoId: string;
  actorUserId: string;
}

export interface CreateVehicleInput {
  registrationNumber: string;
  normalizedRegistration: string;
  type: 'MOTORCYCLE' | 'MATATU';
  saccoId: string;
  actorUserId: string;
}

export interface DirectoryRepository {
  listRiders(saccoId: string, limit: number, cursor?: string): Promise<DirectoryPage<RiderSummary>>;
  createRider(input: CreateRiderInput): Promise<RiderSummary>;
  updateRider(input: UpdateRiderInput): Promise<RiderSummary | null>;
  deactivateRider(riderId: string, saccoId: string, actorUserId: string): Promise<RiderSummary | null>;
  anonymizeSuspendedRider(
    riderId: string,
    saccoId: string,
    actorUserId: string,
  ): Promise<'ANONYMIZED' | 'NOT_FOUND' | 'NOT_SUSPENDED'>;
  listVehicles(saccoId: string, limit: number, cursor?: string): Promise<DirectoryPage<VehicleSummary>>;
  createVehicle(input: CreateVehicleInput): Promise<VehicleSummary>;
}

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(64).optional(),
}).strict();

const createRiderSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phoneNumber: z.string().trim().min(7).max(20),
  email: z.string().trim().email().max(254),
}).strict();

const updateRiderSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phoneNumber: z.string().trim().min(7).max(20),
  email: z.string().trim().email().max(254).nullable(),
}).strict();

const createVehicleSchema = z.object({
  registrationNumber: z.string().trim().min(3).max(20),
  type: z.enum(['MOTORCYCLE', 'MATATU']),
}).strict();

export function createDirectoryRouter(
  authRepository: AuthRepository,
  directoryRepository: DirectoryRepository,
  accessTokenSecret: string,
  emailSender: EmailSender,
): Router {
  const router = Router();
  const authenticate = authenticateRequest(authRepository, accessTokenSecret);
  const authorize = requireRoles('SACCO_ADMIN');

  router.get('/riders', authenticate, authorize, async (request, response) => {
    const query = listSchema.safeParse(request.query);
    const saccoId = request.authenticatedUser?.saccoId;
    if (!query.success || !saccoId) {
      response.status(query.success ? 403 : 400).json({
        error: query.success
          ? { code: 'FORBIDDEN', message: 'A SACCO administrator account is required.' }
          : { code: 'INVALID_REQUEST', message: 'Provide a valid page limit and cursor.' },
      });
      return;
    }

    const page = await directoryRepository.listRiders(saccoId, query.data.limit, query.data.cursor);
    response.status(200).json(page);
  });

  router.post('/riders', authenticate, authorize, async (request: Request, response: Response) => {
    const input = createRiderSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Provide a rider name, Kenyan phone number, and valid email address.',
        },
      });
      return;
    }

    const actor = request.authenticatedUser;
    const phoneNumber = normalizeKenyanPhoneNumber(input.data.phoneNumber);
    if (!actor?.saccoId || !phoneNumber) {
      response.status(actor?.saccoId ? 400 : 403).json({
        error: actor?.saccoId
          ? { code: 'INVALID_REQUEST', message: 'Enter a valid Kenyan mobile phone number.' }
          : { code: 'FORBIDDEN', message: 'A SACCO administrator account is required.' },
      });
      return;
    }

    try {
      const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
      const rider = await directoryRepository.createRider({
        fullName: input.data.fullName,
        phoneNumber,
        email: input.data.email.trim().toLowerCase(),
        passwordHash,
        saccoId: actor.saccoId,
        actorUserId: actor.id,
      });
      const account: AuthAccount = {
        ...rider,
        emailVerifiedAt: null,
        role: 'RIDER',
        saccoId: actor.saccoId,
        saccoName: actor.saccoName,
        saccoStatus: 'ACTIVE',
        passwordHash,
      };
      try {
        await issueEmailVerificationCode(authRepository, emailSender, account, 'EMAIL_VERIFICATION', accessTokenSecret);
      } catch (error) {
        const rateLimited = error instanceof VerificationRateLimitError;
        if (!rateLimited) {
          console.error(JSON.stringify({
            level: 'error',
            message: 'Rider activation email delivery failed',
            errorType: error instanceof Error ? error.name : 'UnknownError',
          }));
        }
        response.status(rateLimited ? 429 : 503).json({
          error: {
            code: rateLimited ? 'VERIFICATION_RATE_LIMITED' : 'RIDER_CREATED_EMAIL_FAILED',
            message: 'The rider account was created, but the activation email could not be sent. The rider can request a new code in the app.',
          },
        });
        return;
      }
      response.status(201).json({ data: rider });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        response.status(409).json({
          error: { code: 'ALREADY_EXISTS', message: 'A user with that phone number or email already exists.' },
        });
        return;
      }
      throw error;
    }
  });

  router.patch('/riders/:riderId', authenticate, authorize, async (request: Request, response: Response) => {
    const input = updateRiderSchema.safeParse(request.body);
    const actor = request.authenticatedUser;
    const phoneNumber = input.success ? normalizeKenyanPhoneNumber(input.data.phoneNumber) : null;
    if (!input.success || !phoneNumber || !actor?.saccoId) {
      response.status(!actor?.saccoId ? 403 : 400).json({
        error: !actor?.saccoId
          ? { code: 'FORBIDDEN', message: 'A SACCO administrator account is required.' }
          : { code: 'INVALID_REQUEST', message: 'Provide a rider name, valid Kenyan phone number, and valid email address or leave email blank.' },
      });
      return;
    }

    const riderId = z.string().min(1).max(64).safeParse(request.params.riderId);
    if (!riderId.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Provide a valid rider account.' },
      });
      return;
    }

    const email = input.data.email?.trim().toLowerCase() || null;
    try {
      const previousAccount = await authRepository.findUserById(riderId.data);
      const rider = await directoryRepository.updateRider({
        riderId: riderId.data,
        fullName: input.data.fullName,
        phoneNumber,
        email,
        saccoId: actor.saccoId,
        actorUserId: actor.id,
      });
      if (!rider) {
        response.status(404).json({
          error: { code: 'RIDER_NOT_FOUND', message: 'That rider account was not found in your SACCO.' },
        });
        return;
      }

      const emailChanged = previousAccount?.email !== rider.email;
      if (emailChanged && rider.email) {
        const updatedAccount = await authRepository.findUserById(rider.id);
        if (!updatedAccount) throw new Error('Updated rider account could not be loaded for email verification.');
        try {
          await issueEmailVerificationCode(
            authRepository,
            emailSender,
            updatedAccount,
            'EMAIL_VERIFICATION',
            accessTokenSecret,
          );
        } catch (error) {
          const rateLimited = error instanceof VerificationRateLimitError;
          if (!rateLimited) {
            console.error(JSON.stringify({
              level: 'error',
              message: 'Rider email update verification delivery failed',
              errorType: error instanceof Error ? error.name : 'UnknownError',
            }));
          }
          response.status(rateLimited ? 429 : 503).json({
            data: rider,
            error: {
              code: rateLimited ? 'VERIFICATION_RATE_LIMITED' : 'RIDER_UPDATED_EMAIL_FAILED',
              message: 'The rider details were saved, but an email verification code could not be sent. Resend the code from the rider app after delivery is available.',
            },
          });
          return;
        }
      }
      response.status(200).json({ data: rider });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        response.status(409).json({
          error: { code: 'ALREADY_EXISTS', message: 'Another account already uses that phone number or email.' },
        });
        return;
      }
      throw error;
    }
  });

  router.delete('/riders/:riderId', authenticate, authorize, async (request: Request, response: Response) => {
    const actor = request.authenticatedUser;
    const riderId = z.string().min(1).max(64).safeParse(request.params.riderId);
    if (!actor?.saccoId) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'A SACCO administrator account is required.' },
      });
      return;
    }
    if (!riderId.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Provide a valid rider account.' },
      });
      return;
    }

    const rider = await directoryRepository.deactivateRider(riderId.data, actor.saccoId, actor.id);
    if (!rider) {
      response.status(404).json({
        error: { code: 'RIDER_NOT_FOUND', message: 'That rider account was not found in your SACCO.' },
      });
      return;
    }
    response.status(200).json({ data: rider });
  });

  router.delete('/riders/:riderId/account', authenticate, authorize, async (request: Request, response: Response) => {
    const actor = request.authenticatedUser;
    const riderId = z.string().min(1).max(64).safeParse(request.params.riderId);
    if (!actor?.saccoId) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'A SACCO administrator account is required.' },
      });
      return;
    }
    if (!riderId.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Provide a valid rider account.' },
      });
      return;
    }

    const result = await directoryRepository.anonymizeSuspendedRider(riderId.data, actor.saccoId, actor.id);
    if (result === 'NOT_FOUND') {
      response.status(404).json({
        error: { code: 'RIDER_NOT_FOUND', message: 'That rider account was not found in your SACCO.' },
      });
      return;
    }
    if (result === 'NOT_SUSPENDED') {
      response.status(409).json({
        error: { code: 'RIDER_NOT_SUSPENDED', message: 'Suspend this rider before deleting the account.' },
      });
      return;
    }
    response.status(200).json({ data: { id: riderId.data } });
  });

  router.get('/vehicles', authenticate, authorize, async (request, response) => {
    const query = listSchema.safeParse(request.query);
    const saccoId = request.authenticatedUser?.saccoId;
    if (!query.success || !saccoId) {
      response.status(query.success ? 403 : 400).json({
        error: query.success
          ? { code: 'FORBIDDEN', message: 'A SACCO administrator account is required.' }
          : { code: 'INVALID_REQUEST', message: 'Provide a valid page limit and cursor.' },
      });
      return;
    }

    const page = await directoryRepository.listVehicles(saccoId, query.data.limit, query.data.cursor);
    response.status(200).json(page);
  });

  router.post('/vehicles', authenticate, authorize, async (request, response) => {
    const input = createVehicleSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Provide a valid vehicle registration number and type.' },
      });
      return;
    }

    const actor = request.authenticatedUser;
    if (!actor?.saccoId) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'A SACCO administrator account is required.' },
      });
      return;
    }

    const registrationNumber = input.data.registrationNumber.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z0-9-]{3,20}$/.test(registrationNumber)) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Enter a valid vehicle registration number.' },
      });
      return;
    }

    try {
      const vehicle = await directoryRepository.createVehicle({
        registrationNumber: input.data.registrationNumber.trim().toUpperCase(),
        normalizedRegistration: registrationNumber,
        type: input.data.type,
        saccoId: actor.saccoId,
        actorUserId: actor.id,
      });
      response.status(201).json({ data: vehicle });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        response.status(409).json({
          error: { code: 'ALREADY_EXISTS', message: 'A vehicle with that registration already exists in this SACCO.' },
        });
        return;
      }
      throw error;
    }
  });

  return router;
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
