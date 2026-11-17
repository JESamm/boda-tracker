import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  authenticateRequest,
  hashPassword,
  requireRoles,
  type AuthRepository,
} from '../auth/auth.js';

export interface RiderSummary {
  id: string;
  fullName: string;
  phoneNumber: string;
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
  passwordHash: string;
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
  initialPassword: z.string().min(14).max(128),
}).strict();

const createVehicleSchema = z.object({
  registrationNumber: z.string().trim().min(3).max(20),
  type: z.enum(['MOTORCYCLE', 'MATATU']),
}).strict();

export function createDirectoryRouter(
  authRepository: AuthRepository,
  directoryRepository: DirectoryRepository,
  accessTokenSecret: string,
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
          message: 'Provide a rider name, Kenyan phone number, and initial password of at least 14 characters.',
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
      const rider = await directoryRepository.createRider({
        fullName: input.data.fullName,
        phoneNumber,
        passwordHash: await hashPassword(input.data.initialPassword),
        saccoId: actor.saccoId,
        actorUserId: actor.id,
      });
      response.status(201).json({ data: rider });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        response.status(409).json({
          error: { code: 'ALREADY_EXISTS', message: 'A user with that phone number already exists.' },
        });
        return;
      }
      throw error;
    }
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
