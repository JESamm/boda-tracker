import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { prisma } from './db/prisma.js';
import { createPublicMapsRepository } from './resources/maps.js';
import type { CreateRiderInput, CreateVehicleInput, DirectoryPage } from './resources/directory.js';
import { OperationsRuleError, type AssignmentSummary, type OperationsRepository, type TripSummary, type WorkSessionSummary } from './resources/operations.js';
import type { ProvisionSaccoInput, SaccoSummary } from './resources/saccos.js';

const env = loadEnv();
const allowedOrigins = env.CORS_ALLOWED_ORIGINS
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = createApp({
  allowedOrigins,
  accessTokenSecret: env.AUTH_ACCESS_TOKEN_SECRET,
  database: {
    async ping() {
      await prisma.$queryRaw`SELECT 1`;
    },
  },
  auth: {
    async findUserByPhone(phoneNumber) {
      const user = await prisma.user.findUnique({
        where: { phoneNumber },
        include: { sacco: { select: { name: true, status: true } } },
      });
      if (!user) return null;
      return {
        ...user,
        saccoName: user.sacco?.name ?? null,
        saccoStatus: user.sacco?.status ?? null,
      };
    },
    async findUserById(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { sacco: { select: { name: true, status: true } } },
      });
      if (!user) return null;
      return {
        ...user,
        saccoName: user.sacco?.name ?? null,
        saccoStatus: user.sacco?.status ?? null,
      };
    },
    async findRefreshSession(tokenHash) {
      const session = await prisma.refreshToken.findUnique({
        where: { tokenHash },
        include: {
          user: { include: { sacco: { select: { name: true, status: true } } } },
        },
      });
      if (!session) return null;
      const { user } = session;
      return {
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
        user: {
          ...user,
          saccoName: user.sacco?.name ?? null,
          saccoStatus: user.sacco?.status ?? null,
        },
      };
    },
    async createRefreshSession(userId, tokenHash, expiresAt) {
      await prisma.refreshToken.create({
        data: { userId, tokenHash, expiresAt },
      });
    },
    async rotateRefreshSession(currentId, userId, tokenHash, expiresAt) {
      const result = await prisma.$transaction(async (transaction) => {
        const revoked = await transaction.refreshToken.updateMany({
          where: {
            id: currentId,
            userId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { revokedAt: new Date(), replacedBy: tokenHash },
        });
        if (revoked.count !== 1) return false;
        await transaction.refreshToken.create({
          data: { userId, tokenHash, expiresAt },
        });
        return true;
      });
      return result;
    },
    async revokeRefreshSession(tokenHash) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
    async revokeAllRefreshSessions(userId) {
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  },
  saccos: {
    async listSaccos(limit) {
      const records = await prisma.sacco.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          users: {
            where: { role: 'SACCO_ADMIN' },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { id: true, fullName: true, phoneNumber: true },
          },
        },
      });
      return records.map((record) => mapSaccoSummary(record, record.users[0]));
    },
    async createSacco(input: ProvisionSaccoInput) {
      return prisma.$transaction(async (transaction) => {
        const sacco = await transaction.sacco.create({
          data: {
            name: input.name,
            registrationNumber: input.registrationNumber,
            phoneNumber: input.phoneNumber,
            operatingArea: input.operatingArea,
          },
        });
        const administrator = await transaction.user.create({
          data: {
            fullName: input.adminFullName,
            phoneNumber: input.adminPhoneNumber,
            passwordHash: input.adminPasswordHash,
            role: 'SACCO_ADMIN',
            status: 'ACTIVE',
            saccoId: sacco.id,
          },
          select: { id: true, fullName: true, phoneNumber: true },
        });
        await transaction.auditLog.create({
          data: {
            saccoId: sacco.id,
            actorUserId: input.actor?.id ?? administrator.id,
            action: input.actor ? 'sacco.created' : 'sacco.self_registered',
            entityType: 'Sacco',
            entityId: sacco.id,
            metadata: { administratorId: administrator.id },
          },
        });
        return mapSaccoSummary(sacco, administrator);
      });
    },
  },
  directory: {
    async listRiders(saccoId, limit, cursor) {
      const records = await prisma.user.findMany({
        where: { saccoId, role: 'RIDER' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor
          ? { cursor: { id_saccoId: { id: cursor, saccoId } }, skip: 1 }
          : {}),
        select: { id: true, fullName: true, phoneNumber: true, status: true, createdAt: true },
      });
      return makeDirectoryPage(records, limit);
    },
    async createRider(input: CreateRiderInput) {
      return prisma.$transaction(async (transaction) => {
        const rider = await transaction.user.create({
          data: {
            fullName: input.fullName,
            phoneNumber: input.phoneNumber,
            passwordHash: input.passwordHash,
            role: 'RIDER',
            status: 'ACTIVE',
            saccoId: input.saccoId,
          },
          select: { id: true, fullName: true, phoneNumber: true, status: true, createdAt: true },
        });
        await transaction.auditLog.create({
          data: {
            saccoId: input.saccoId,
            actorUserId: input.actorUserId,
            action: 'rider.created',
            entityType: 'User',
            entityId: rider.id,
          },
        });
        return rider;
      });
    },
    async listVehicles(saccoId, limit, cursor) {
      const records = await prisma.vehicle.findMany({
        where: { saccoId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor
          ? { cursor: { id_saccoId: { id: cursor, saccoId } }, skip: 1 }
          : {}),
        select: { id: true, registrationNumber: true, type: true, status: true, createdAt: true },
      });
      return makeDirectoryPage(records, limit);
    },
    async createVehicle(input: CreateVehicleInput) {
      return prisma.$transaction(async (transaction) => {
        const vehicle = await transaction.vehicle.create({
          data: {
            registrationNumber: input.registrationNumber,
            normalizedRegistration: input.normalizedRegistration,
            type: input.type,
            saccoId: input.saccoId,
          },
          select: { id: true, registrationNumber: true, type: true, status: true, createdAt: true },
        });
        await transaction.auditLog.create({
          data: {
            saccoId: input.saccoId,
            actorUserId: input.actorUserId,
            action: 'vehicle.created',
            entityType: 'Vehicle',
            entityId: vehicle.id,
          },
        });
        return vehicle;
      });
    },
  },
  maps: createPublicMapsRepository(),
  operations: {
    async listAssignments(saccoId) {
      const records = await prisma.vehicleAssignment.findMany({
        where: { saccoId },
        orderBy: [{ status: 'asc' }, { assignedAt: 'desc' }],
        include: {
          rider: { select: { id: true, fullName: true, phoneNumber: true } },
          vehicle: { select: { id: true, registrationNumber: true, type: true } },
        },
      });
      return records.map(mapAssignmentSummary);
    },
    async createAssignment(input) {
      return prisma.$transaction(async (transaction) => {
        const lockKeys = [
          `rider:${input.saccoId}:${input.riderId}`,
          `vehicle:${input.saccoId}:${input.vehicleId}`,
        ].sort();
        for (const key of lockKeys) {
          await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)::text`;
        }
        const [rider, vehicle, activeRiderAssignment, activeVehicleAssignment] = await Promise.all([
          transaction.user.findFirst({
            where: { id: input.riderId, saccoId: input.saccoId, role: 'RIDER', status: 'ACTIVE' },
            select: { id: true },
          }),
          transaction.vehicle.findFirst({
            where: { id: input.vehicleId, saccoId: input.saccoId, status: 'ACTIVE' },
            select: { id: true },
          }),
          transaction.vehicleAssignment.findFirst({
            where: { saccoId: input.saccoId, riderId: input.riderId, status: 'ACTIVE' },
            select: { id: true },
          }),
          transaction.vehicleAssignment.findFirst({
            where: { saccoId: input.saccoId, vehicleId: input.vehicleId, status: 'ACTIVE' },
            select: { id: true },
          }),
        ]);
        if (!rider || !vehicle) {
          throw new OperationsRuleError('Choose an active rider and vehicle from this SACCO.', 'NOT_FOUND');
        }
        if (activeRiderAssignment || activeVehicleAssignment) {
          throw new OperationsRuleError('The rider or vehicle already has an active assignment.', 'CONFLICT');
        }

        const assignment = await transaction.vehicleAssignment.create({
          data: {
            saccoId: input.saccoId,
            riderId: input.riderId,
            vehicleId: input.vehicleId,
            assignedById: input.actorUserId,
          },
          include: {
            rider: { select: { id: true, fullName: true, phoneNumber: true } },
            vehicle: { select: { id: true, registrationNumber: true, type: true } },
          },
        });
        await transaction.auditLog.create({
          data: {
            saccoId: input.saccoId,
            actorUserId: input.actorUserId,
            action: 'vehicle.assignment.created',
            entityType: 'VehicleAssignment',
            entityId: assignment.id,
            metadata: { riderId: input.riderId, vehicleId: input.vehicleId },
          },
        });
        return mapAssignmentSummary(assignment);
      });
    },
    async endAssignment(input) {
      return prisma.$transaction(async (transaction) => {
        const assignment = await transaction.vehicleAssignment.findFirst({
          where: { id: input.assignmentId, saccoId: input.saccoId, status: 'ACTIVE' },
          include: {
            rider: { select: { id: true, fullName: true, phoneNumber: true } },
            vehicle: { select: { id: true, registrationNumber: true, type: true } },
          },
        });
        if (!assignment) return null;

        for (const key of [
          `rider:${input.saccoId}:${assignment.riderId}`,
          `vehicle:${input.saccoId}:${assignment.vehicleId}`,
        ].sort()) {
          await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)::text`;
        }
        const activeSession = await transaction.workSession.findFirst({
          where: { assignmentId: assignment.id, saccoId: input.saccoId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (activeSession) {
          throw new OperationsRuleError('End the rider’s work session before ending this assignment.', 'CONFLICT');
        }

        const updated = await transaction.vehicleAssignment.updateMany({
          where: { id: assignment.id, saccoId: input.saccoId, status: 'ACTIVE' },
          data: { status: 'ENDED', unassignedAt: new Date() },
        });
        if (updated.count !== 1) return null;
        await transaction.auditLog.create({
          data: {
            saccoId: input.saccoId,
            actorUserId: input.actorUserId,
            action: 'vehicle.assignment.ended',
            entityType: 'VehicleAssignment',
            entityId: assignment.id,
          },
        });
        const endedAssignment = await transaction.vehicleAssignment.findUniqueOrThrow({
          where: { id: assignment.id },
          include: {
            rider: { select: { id: true, fullName: true, phoneNumber: true } },
            vehicle: { select: { id: true, registrationNumber: true, type: true } },
          },
        });
        return mapAssignmentSummary(endedAssignment);
      });
    },
    async getRiderWorkspace(saccoId, riderId) {
      const [assignment, workSession] = await Promise.all([
        prisma.vehicleAssignment.findFirst({
          where: { saccoId, riderId, status: 'ACTIVE' },
          orderBy: { assignedAt: 'desc' },
          include: {
            rider: { select: { id: true, fullName: true, phoneNumber: true } },
            vehicle: { select: { id: true, registrationNumber: true, type: true } },
          },
        }),
        prisma.workSession.findFirst({
          where: { saccoId, riderId, status: 'ACTIVE' },
          orderBy: { startedAt: 'desc' },
          include: {
            vehicle: { select: { id: true, registrationNumber: true, type: true } },
          },
        }),
      ]);
      return {
        assignment: assignment ? mapAssignmentSummary(assignment) : null,
        workSession: workSession ? mapWorkSessionSummary(workSession) : null,
      };
    },
    async startWorkSession(saccoId, riderId) {
      return prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`rider:${saccoId}:${riderId}`})::bigint)::text`;
        const assignment = await transaction.vehicleAssignment.findFirst({
          where: { saccoId, riderId, status: 'ACTIVE', rider: { status: 'ACTIVE' }, vehicle: { status: 'ACTIVE' } },
          orderBy: { assignedAt: 'desc' },
          include: { vehicle: { select: { id: true, registrationNumber: true, type: true } } },
        });
        if (!assignment) {
          throw new OperationsRuleError('Ask your SACCO administrator to assign you an active vehicle first.', 'CONFLICT');
        }

        const activeSession = await transaction.workSession.findFirst({
          where: { saccoId, riderId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (activeSession) {
          throw new OperationsRuleError('Your work session is already active.', 'CONFLICT');
        }

        const workSession = await transaction.workSession.create({
          data: {
            saccoId,
            riderId,
            vehicleId: assignment.vehicleId,
            assignmentId: assignment.id,
          },
          include: { vehicle: { select: { id: true, registrationNumber: true, type: true } } },
        });
        await transaction.auditLog.create({
          data: {
            saccoId,
            actorUserId: riderId,
            action: 'work-session.started',
            entityType: 'WorkSession',
            entityId: workSession.id,
            metadata: { vehicleId: assignment.vehicleId, assignmentId: assignment.id },
          },
        });
        return mapWorkSessionSummary(workSession);
      });
    },
    async endWorkSession(saccoId, riderId, sessionId) {
      return prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`rider:${saccoId}:${riderId}`})::bigint)::text`;
        const activeTrip = await transaction.trip.findFirst({
          where: { saccoId, riderId, status: 'IN_PROGRESS' },
          select: { id: true },
        });
        if (activeTrip) {
          throw new OperationsRuleError('Complete your in-progress trip before ending the work session.', 'CONFLICT');
        }
        const updated = await transaction.workSession.updateMany({
          where: { id: sessionId, saccoId, riderId, status: 'ACTIVE' },
          data: { status: 'COMPLETED', endedAt: new Date() },
        });
        if (updated.count !== 1) return null;

        const workSession = await transaction.workSession.findUniqueOrThrow({
          where: { id: sessionId },
          include: { vehicle: { select: { id: true, registrationNumber: true, type: true } } },
        });
        await transaction.auditLog.create({
          data: {
            saccoId,
            actorUserId: riderId,
            action: 'work-session.completed',
            entityType: 'WorkSession',
            entityId: sessionId,
          },
        });
        return mapWorkSessionSummary(workSession);
      });
    },
    async listTrips(saccoId, riderId, limit) {
      const records = await prisma.trip.findMany({
        where: { saccoId, riderId },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: limit,
        include: { vehicle: { select: { id: true, registrationNumber: true, type: true } } },
      });
      return records.map(mapTripSummary);
    },
    async startTrip(saccoId, riderId, idempotencyKey) {
      return prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`rider:${saccoId}:${riderId}`})::bigint)::text`;
        const previousTrip = await transaction.trip.findFirst({
          where: { riderId, idempotencyKey },
          include: { vehicle: { select: { id: true, registrationNumber: true, type: true } } },
        });
        if (previousTrip) return mapTripSummary(previousTrip);

        const workSession = await transaction.workSession.findFirst({
          where: { saccoId, riderId, status: 'ACTIVE' },
          select: { id: true, vehicleId: true },
        });
        if (!workSession) {
          throw new OperationsRuleError('Start a work session before recording a trip.', 'CONFLICT');
        }

        const trip = await transaction.trip.create({
          data: {
            saccoId,
            riderId,
            vehicleId: workSession.vehicleId,
            workSessionId: workSession.id,
            idempotencyKey,
            recordedSource: 'MOBILE',
          },
          include: { vehicle: { select: { id: true, registrationNumber: true, type: true } } },
        });
        await transaction.auditLog.create({
          data: {
            saccoId,
            actorUserId: riderId,
            action: 'trip.started',
            entityType: 'Trip',
            entityId: trip.id,
            metadata: { workSessionId: workSession.id, vehicleId: workSession.vehicleId },
          },
        });
        return mapTripSummary(trip);
      });
    },
    async completeTrip(saccoId, riderId, tripId, fareAmount) {
      return prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`rider:${saccoId}:${riderId}`})::bigint)::text`;
        const trip = await transaction.trip.findFirst({
          where: { id: tripId, saccoId, riderId },
          include: { vehicle: { select: { id: true, registrationNumber: true, type: true } } },
        });
        if (!trip) return null;
        if (trip.status === 'COMPLETED') {
          if (trip.fareAmount?.toFixed(2) === fareAmount) return mapTripSummary(trip);
          throw new OperationsRuleError('This trip was already completed with a different fare.', 'CONFLICT');
        }
        if (trip.status !== 'IN_PROGRESS') {
          throw new OperationsRuleError('Only an in-progress trip can be completed.', 'CONFLICT');
        }

        const activeWorkSession = await transaction.workSession.findFirst({
          where: { id: trip.workSessionId, saccoId, riderId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!activeWorkSession) {
          throw new OperationsRuleError('An active work session is required to complete this trip.', 'CONFLICT');
        }

        const updated = await transaction.trip.updateMany({
          where: { id: tripId, saccoId, riderId, status: 'IN_PROGRESS' },
          data: { status: 'COMPLETED', endedAt: new Date(), fareAmount },
        });
        if (updated.count !== 1) return null;

        const completedTrip = await transaction.trip.findUniqueOrThrow({
          where: { id: tripId },
          include: { vehicle: { select: { id: true, registrationNumber: true, type: true } } },
        });
        await transaction.auditLog.create({
          data: {
            saccoId,
            actorUserId: riderId,
            action: 'trip.completed',
            entityType: 'Trip',
            entityId: tripId,
            metadata: { fareAmount },
          },
        });
        return mapTripSummary(completedTrip);
      });
    },
  } satisfies OperationsRepository,
});

function makeDirectoryPage<T extends { id: string }>(records: T[], limit: number): DirectoryPage<T> {
  const hasMore = records.length > limit;
  const data = records.slice(0, limit);
  return {
    data,
    nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
  };
}

function mapSaccoSummary(
  record: {
    id: string;
    name: string;
    registrationNumber: string | null;
    phoneNumber: string | null;
    operatingArea: string | null;
    status: 'ACTIVE' | 'SUSPENDED';
    createdAt: Date;
  },
  administrator: SaccoSummary['administrator'] | undefined,
): SaccoSummary {
  if (!administrator) {
    throw new Error(`SACCO ${record.id} has no administrator.`);
  }
  return {
    id: record.id,
    name: record.name,
    registrationNumber: record.registrationNumber,
    phoneNumber: record.phoneNumber,
    operatingArea: record.operatingArea,
    status: record.status,
    createdAt: record.createdAt,
    administrator,
  };
}

function mapAssignmentSummary(record: {
  id: string;
  status: 'ACTIVE' | 'ENDED';
  assignedAt: Date;
  unassignedAt: Date | null;
  rider: AssignmentSummary['rider'];
  vehicle: AssignmentSummary['vehicle'];
}): AssignmentSummary {
  return {
    id: record.id,
    status: record.status,
    assignedAt: record.assignedAt,
    unassignedAt: record.unassignedAt,
    rider: record.rider,
    vehicle: record.vehicle,
  };
}

function mapWorkSessionSummary(record: {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  status: 'ACTIVE' | 'COMPLETED' | 'INTERRUPTED';
  vehicle: WorkSessionSummary['vehicle'];
}): WorkSessionSummary {
  return {
    id: record.id,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    status: record.status,
    vehicle: record.vehicle,
  };
}

function mapTripSummary(record: {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  fareAmount: { toFixed(decimalPlaces?: number): string } | null;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  vehicle: TripSummary['vehicle'];
}): TripSummary {
  return {
    id: record.id,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    fareAmount: record.fareAmount?.toFixed(2) ?? null,
    status: record.status,
    vehicle: record.vehicle,
  };
}

const server = app.listen(env.PORT, () => {
  console.info(JSON.stringify({
    level: 'info',
    message: 'Boda-Tracker API listening',
    port: env.PORT,
    environment: env.APP_ENV,
  }));
});

async function shutdown(signal: string) {
  console.info(JSON.stringify({ level: 'info', message: 'Shutting down API', signal }));
  server.close(async (error) => {
    if (error) {
      console.error(JSON.stringify({ level: 'error', message: 'HTTP server shutdown failed', error: error.message }));
      process.exitCode = 1;
    }

    await prisma.$disconnect();
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
