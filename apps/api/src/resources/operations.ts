import { Router } from 'express';
import { z } from 'zod';
import { authenticateRequest, requireRoles, type AuthRepository } from '../auth/auth.js';

export interface AssignmentSummary {
  id: string;
  status: 'ACTIVE' | 'ENDED';
  assignedAt: Date;
  unassignedAt: Date | null;
  rider: {
    id: string;
    fullName: string;
    phoneNumber: string;
  };
  vehicle: {
    id: string;
    registrationNumber: string;
    type: 'MOTORCYCLE' | 'MATATU';
  };
}

export interface WorkSessionSummary {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  status: 'ACTIVE' | 'COMPLETED' | 'INTERRUPTED';
  vehicle: AssignmentSummary['vehicle'];
}

export interface TripSummary {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  fareAmount: string | null;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  vehicle: AssignmentSummary['vehicle'];
}

export interface RiderWorkspaceSummary {
  assignment: AssignmentSummary | null;
  workSession: WorkSessionSummary | null;
}

export interface OperationsRepository {
  listAssignments(saccoId: string): Promise<AssignmentSummary[]>;
  createAssignment(input: {
    saccoId: string;
    riderId: string;
    vehicleId: string;
    actorUserId: string;
  }): Promise<AssignmentSummary>;
  endAssignment(input: {
    saccoId: string;
    assignmentId: string;
    actorUserId: string;
  }): Promise<AssignmentSummary | null>;
  getRiderWorkspace(saccoId: string, riderId: string): Promise<RiderWorkspaceSummary>;
  startWorkSession(saccoId: string, riderId: string): Promise<WorkSessionSummary>;
  endWorkSession(saccoId: string, riderId: string, sessionId: string): Promise<WorkSessionSummary | null>;
  listTrips(saccoId: string, riderId: string, limit: number): Promise<TripSummary[]>;
  startTrip(saccoId: string, riderId: string, idempotencyKey: string): Promise<TripSummary>;
  completeTrip(
    saccoId: string,
    riderId: string,
    tripId: string,
    fareAmount: string,
  ): Promise<TripSummary | null>;
}

export class OperationsRuleError extends Error {
  constructor(
    message: string,
    readonly code: 'CONFLICT' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'OperationsRuleError';
  }
}

const assignmentSchema = z.object({
  riderId: z.string().min(1).max(64),
  vehicleId: z.string().min(1).max(64),
}).strict();
const tripIdempotencyKeySchema = z.string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const fareAmountSchema = z.string()
  .regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, 'Enter a fare from 0 to 9,999,999,999.99 with up to two decimal places.')
  .transform((value) => {
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${fraction.padEnd(2, '0')}`;
  });

export function createOperationsRouter(
  authRepository: AuthRepository,
  operationsRepository: OperationsRepository,
  accessTokenSecret: string,
): Router {
  const router = Router();
  const authenticate = authenticateRequest(authRepository, accessTokenSecret);
  const authorizeAdmin = requireRoles('SACCO_ADMIN');
  const authorizeRider = requireRoles('RIDER');

  router.get('/assignments', authenticate, authorizeAdmin, async (request, response) => {
    const saccoId = request.authenticatedUser?.saccoId;
    if (!saccoId) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'A SACCO administrator account is required.' },
      });
      return;
    }

    response.status(200).json({ data: await operationsRepository.listAssignments(saccoId) });
  });

  router.post('/assignments', authenticate, authorizeAdmin, async (request, response) => {
    const input = assignmentSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Select a rider and an available vehicle.' },
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

    try {
      const assignment = await operationsRepository.createAssignment({
        saccoId: actor.saccoId,
        riderId: input.data.riderId,
        vehicleId: input.data.vehicleId,
        actorUserId: actor.id,
      });
      response.status(201).json({ data: assignment });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        response.status(409).json({
          error: { code: 'CONFLICT', message: 'That rider or vehicle already has an active assignment.' },
        });
        return;
      }
      if (error instanceof OperationsRuleError) {
        response.status(error.code === 'NOT_FOUND' ? 404 : 409).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }
      throw error;
    }
  });

  router.post('/assignments/:assignmentId/end', authenticate, authorizeAdmin, async (request, response) => {
    const rawAssignmentId = request.params.assignmentId;
    const assignmentId = Array.isArray(rawAssignmentId) ? undefined : rawAssignmentId;
    if (!assignmentId || assignmentId.length > 64) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Provide a valid assignment.' },
      });
      return;
    }
    const saccoId = request.authenticatedUser?.saccoId;
    const actorUserId = request.authenticatedUser?.id;
    if (!saccoId || !actorUserId) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'A SACCO administrator account is required.' },
      });
      return;
    }

    try {
      const assignment = await operationsRepository.endAssignment({ saccoId, assignmentId, actorUserId });
      if (!assignment) {
        response.status(404).json({
          error: { code: 'NOT_FOUND', message: 'The active assignment was not found in this SACCO.' },
        });
        return;
      }
      response.status(200).json({ data: assignment });
    } catch (error) {
      if (error instanceof OperationsRuleError) {
        response.status(error.code === 'NOT_FOUND' ? 404 : 409).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }
      throw error;
    }
  });

  router.get('/rider/workspace', authenticate, authorizeRider, async (request, response) => {
    const rider = request.authenticatedUser;
    if (!rider?.saccoId) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'An active SACCO rider account is required.' },
      });
      return;
    }

    response.status(200).json({
      data: await operationsRepository.getRiderWorkspace(rider.saccoId, rider.id),
    });
  });

  router.post('/work-sessions/start', authenticate, authorizeRider, async (request, response) => {
    const rider = request.authenticatedUser;
    if (!rider?.saccoId) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'An active SACCO rider account is required.' },
      });
      return;
    }

    try {
      const workSession = await operationsRepository.startWorkSession(rider.saccoId, rider.id);
      response.status(201).json({ data: workSession });
    } catch (error) {
      if (error instanceof OperationsRuleError) {
        response.status(error.code === 'NOT_FOUND' ? 404 : 409).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }
      if (isUniqueConstraintError(error)) {
        response.status(409).json({
          error: { code: 'CONFLICT', message: 'A work session is already active for this rider.' },
        });
        return;
      }
      throw error;
    }
  });

  router.post('/work-sessions/:sessionId/end', authenticate, authorizeRider, async (request, response) => {
    const rider = request.authenticatedUser;
    const rawSessionId = request.params.sessionId;
    const sessionId = Array.isArray(rawSessionId) ? undefined : rawSessionId;
    if (!rider?.saccoId) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'An active SACCO rider account is required.' },
      });
      return;
    }
    if (!sessionId || sessionId.length > 64) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Provide a valid work session.' },
      });
      return;
    }

    try {
      const workSession = await operationsRepository.endWorkSession(rider.saccoId, rider.id, sessionId);
      if (!workSession) {
        response.status(404).json({
          error: { code: 'NOT_FOUND', message: 'The active work session was not found.' },
        });
        return;
      }
      response.status(200).json({ data: workSession });
    } catch (error) {
      if (error instanceof OperationsRuleError) {
        response.status(error.code === 'NOT_FOUND' ? 404 : 409).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }
      throw error;
    }
  });

  router.get('/trips', authenticate, authorizeRider, async (request, response) => {
    const rider = request.authenticatedUser;
    if (!rider?.saccoId) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'An active SACCO rider account is required.' },
      });
      return;
    }

    const rawLimit = request.query.limit;
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Trip history limit must be between 1 and 100.' },
      });
      return;
    }

    response.status(200).json({
      data: await operationsRepository.listTrips(rider.saccoId, rider.id, limit),
    });
  });

  router.post('/trips/start', authenticate, authorizeRider, async (request, response) => {
    const rider = request.authenticatedUser;
    if (!rider?.saccoId) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'An active SACCO rider account is required.' },
      });
      return;
    }

    const idempotencyKey = tripIdempotencyKeySchema.safeParse(request.get('Idempotency-Key'));
    if (!idempotencyKey.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'A valid Idempotency-Key header is required.' },
      });
      return;
    }

    try {
      const trip = await operationsRepository.startTrip(rider.saccoId, rider.id, idempotencyKey.data);
      response.status(201).json({ data: trip });
    } catch (error) {
      if (error instanceof OperationsRuleError) {
        response.status(error.code === 'NOT_FOUND' ? 404 : 409).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }
      if (isUniqueConstraintError(error)) {
        response.status(409).json({
          error: { code: 'CONFLICT', message: 'A trip is already in progress for this rider.' },
        });
        return;
      }
      throw error;
    }
  });

  router.post('/trips/:tripId/complete', authenticate, authorizeRider, async (request, response) => {
    const rider = request.authenticatedUser;
    const rawTripId = request.params.tripId;
    const tripId = Array.isArray(rawTripId) ? undefined : rawTripId;
    if (!rider?.saccoId) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'An active SACCO rider account is required.' },
      });
      return;
    }
    if (!tripId || tripId.length > 64) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Provide a valid trip.' },
      });
      return;
    }

    const input = z.object({ fareAmount: fareAmountSchema }).strict().safeParse(request.body);
    if (!input.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Enter a valid fare amount with no more than two decimal places.' },
      });
      return;
    }

    try {
      const trip = await operationsRepository.completeTrip(
        rider.saccoId,
        rider.id,
        tripId,
        input.data.fareAmount,
      );
      if (!trip) {
        response.status(404).json({
          error: { code: 'NOT_FOUND', message: 'The in-progress trip was not found.' },
        });
        return;
      }
      response.status(200).json({ data: trip });
    } catch (error) {
      if (error instanceof OperationsRuleError) {
        response.status(error.code === 'NOT_FOUND' ? 404 : 409).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }
      throw error;
    }
  });

  return router;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P2002';
}
