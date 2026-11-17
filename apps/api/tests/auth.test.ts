import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword, type AuthAccount, type AuthRepository, type RefreshSession } from '../src/auth/auth.js';
import type { CreateRiderInput, CreateVehicleInput, DirectoryRepository, RiderSummary, VehicleSummary } from '../src/resources/directory.js';
import { MapsServiceError, type MapsRepository } from '../src/resources/maps.js';
import { OperationsRuleError, type AssignmentSummary, type OperationsRepository, type RiderWorkspaceSummary, type TripSummary, type WorkSessionSummary } from '../src/resources/operations.js';
import type { ProvisionSaccoInput, SaccoRepository, SaccoSummary } from '../src/resources/saccos.js';

const accessTokenSecret = 'auth-test-secret-that-is-long-enough-to-sign-access-tokens';
const password = 'secure-test-password';
const phoneNumber = '+254712345678';
let passwordHash: string;

const activeAccount: AuthAccount = {
  id: 'user-1',
  fullName: 'Test SACCO Admin',
  phoneNumber,
  passwordHash: '',
  role: 'SACCO_ADMIN',
  saccoId: 'sacco-1',
  saccoName: 'Test SACCO',
  saccoStatus: 'ACTIVE',
  status: 'ACTIVE',
};

function createTestApi(
  role: AuthAccount['role'] = 'SACCO_ADMIN',
  saccoRepository?: SaccoRepository,
  directoryRepository?: DirectoryRepository,
  operationsRepository?: OperationsRepository,
  mapsRepository?: MapsRepository,
) {
  let account = {
    ...activeAccount,
    passwordHash,
    role,
    saccoId: role === 'PLATFORM_ADMIN' ? null : activeAccount.saccoId,
    saccoName: role === 'PLATFORM_ADMIN' ? null : activeAccount.saccoName,
    saccoStatus: role === 'PLATFORM_ADMIN' ? null : activeAccount.saccoStatus,
  };
  const sessions: RefreshSession[] = [];
  const revokedAll = vi.fn(async () => undefined);
  const repository: AuthRepository = {
    async findUserByPhone(phone) {
      return phone === account.phoneNumber ? account : null;
    },
    async findUserById(id) {
      return id === account.id ? account : null;
    },
    async findRefreshSession(tokenHash) {
      return sessions.find((session) => session.id === tokenHash) ?? null;
    },
    async createRefreshSession(userId, tokenHash, expiresAt) {
      sessions.push({
        id: tokenHash,
        userId,
        expiresAt,
        revokedAt: null,
        user: account,
      });
    },
    async rotateRefreshSession(currentId, userId, tokenHash, expiresAt) {
      const previous = sessions.find((session) => session.id === currentId);
      if (!previous || previous.revokedAt || previous.expiresAt <= new Date()) return false;
      previous.revokedAt = new Date();
      sessions.push({
        id: tokenHash,
        userId,
        expiresAt,
        revokedAt: null,
        user: account,
      });
      return true;
    },
    async revokeRefreshSession(tokenHash) {
      const session = sessions.find((item) => item.id === tokenHash);
      if (session) session.revokedAt = new Date();
    },
    async revokeAllRefreshSessions(userId) {
      revokedAll();
      for (const session of sessions) {
        if (session.userId === userId) session.revokedAt = new Date();
      }
    },
  };
  const defaultSaccoRepository: SaccoRepository = {
    async listSaccos() { return []; },
    async createSacco() { throw new Error('SACCO provisioning is not used in these tests.'); },
  };
  const defaultDirectoryRepository: DirectoryRepository = {
    async listRiders() { return { data: [], nextCursor: null }; },
    async createRider() { throw new Error('Directory methods are not used in this test.'); },
    async listVehicles() { return { data: [], nextCursor: null }; },
    async createVehicle() { throw new Error('Directory methods are not used in this test.'); },
  };
  const defaultOperationsRepository: OperationsRepository = {
    async listAssignments() { return []; },
    async createAssignment() { throw new Error('Operations are not used in this test.'); },
    async endAssignment() { return null; },
    async getRiderWorkspace() { return { assignment: null, workSession: null }; },
    async startWorkSession() { throw new Error('Operations are not used in this test.'); },
    async endWorkSession() { return null; },
    async listTrips() { return []; },
    async startTrip() { throw new Error('Operations are not used in this test.'); },
    async completeTrip() { return null; },
  };
  const defaultMapsRepository: MapsRepository = {
    async searchPlaces() { return []; },
    async getRoutes() { return []; },
    async getTile() {
      return {
        body: new Uint8Array(),
        contentType: 'image/png',
        cacheControl: 'public, max-age=604800',
        etag: null,
        expires: null,
        lastModified: null,
      };
    },
  };

  const app = createApp({
    allowedOrigins: ['http://localhost:3000'],
    database: { async ping() {} },
    auth: repository,
    saccos: saccoRepository ?? defaultSaccoRepository,
    directory: directoryRepository ?? defaultDirectoryRepository,
    maps: mapsRepository ?? defaultMapsRepository,
    operations: operationsRepository ?? defaultOperationsRepository,
    accessTokenSecret,
  });

  return {
    app,
    sessions,
    revokedAll,
    setAccountStatus(status: AuthAccount['status']) {
      account = { ...account, status };
    },
  };
}

beforeAll(async () => {
  passwordHash = await hashPassword(password);
});

describe('authentication endpoints', () => {
  it('normalizes Kenyan phone numbers and returns an access token without exposing password data', async () => {
    const { app } = createTestApi();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber: '0712 345 678', password });

    expect(login.status).toBe(200);
    expect(login.body.user).toEqual({
      id: 'user-1',
      fullName: 'Test SACCO Admin',
      phoneNumber,
      role: 'SACCO_ADMIN',
      saccoId: 'sacco-1',
      saccoName: 'Test SACCO',
    });
    expect(login.body).not.toHaveProperty('passwordHash');
    expect(login.body.accessToken).toEqual(expect.any(String));

    const profile = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(profile.status).toBe(200);
    expect(profile.body.user.id).toBe('user-1');
  });

  it('returns the same unauthorized error for unknown accounts and incorrect passwords', async () => {
    const { app } = createTestApi();
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password: 'wrong-password' });
    const unknownUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber: '+254722222222', password });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });

  it('rejects invalid access tokens and accounts suspended after the token was issued', async () => {
    const { app, setAccountStatus } = createTestApi();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });

    const invalid = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid.token.value');
    expect(invalid.status).toBe(401);

    setAccountStatus('SUSPENDED');
    const suspended = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(suspended.status).toBe(401);
  });

  it('rotates refresh tokens and prevents reuse of the replaced token', async () => {
    const { app, revokedAll } = createTestApi();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(login.body.refreshToken);

    const replayed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });
    expect(replayed.status).toBe(401);
    expect(revokedAll).toHaveBeenCalledOnce();
  });

  it('revokes a refresh token on logout', async () => {
    const { app, sessions } = createTestApi();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: login.body.refreshToken });

    expect(response.status).toBe(204);
    expect(sessions[0].revokedAt).toBeInstanceOf(Date);
  });

  it('rejects extra login fields and malformed credentials', async () => {
    const { app } = createTestApi();
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password, role: 'PLATFORM_ADMIN' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });
});

describe('SACCO provisioning', () => {
  it('allows only platform administrators to provision a SACCO and its initial administrator', async () => {
    let provisioned: ProvisionSaccoInput | undefined;
    const record: SaccoSummary = {
      id: 'new-sacco',
      name: 'Nairobi Riders SACCO',
      registrationNumber: null,
      phoneNumber: '+254722222222',
      operatingArea: 'Nairobi',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      administrator: {
        id: 'sacco-admin',
        fullName: 'SACCO Manager',
        phoneNumber: '+254711111111',
      },
    };
    const saccoRepository: SaccoRepository = {
      async listSaccos() { return [record]; },
      async createSacco(input) {
        provisioned = input;
        return record;
      },
    };
    const { app: platformApp } = createTestApi('PLATFORM_ADMIN', saccoRepository);
    const login = await request(platformApp)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const created = await request(platformApp)
      .post('/api/v1/saccos')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({
        name: 'Nairobi Riders SACCO',
        registrationNumber: '',
        phoneNumber: '0722 222 222',
        operatingArea: 'Nairobi',
        adminFullName: 'SACCO Manager',
        adminPhoneNumber: '0711 111 111',
        adminPassword: 'A-unique-temporary-password-937!',
      });

    expect(created.status).toBe(201);
    expect(created.body.data.registrationNumber).toBeNull();
    expect(provisioned?.registrationNumber).toBeNull();
    expect(provisioned?.phoneNumber).toBe('+254722222222');
    expect(provisioned?.adminPhoneNumber).toBe('+254711111111');
    expect(provisioned?.adminPasswordHash).not.toBe('A-unique-temporary-password-937!');

    const { app: saccoAdminApp } = createTestApi('SACCO_ADMIN', saccoRepository);
    const saccoAdminLogin = await request(saccoAdminApp)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const forbidden = await request(saccoAdminApp)
      .get('/api/v1/saccos')
      .set('Authorization', `Bearer ${saccoAdminLogin.body.accessToken}`);
    expect(forbidden.status).toBe(403);
  });

  it('rejects duplicate SACCO registration or administrator phone numbers', async () => {
    const saccoRepository: SaccoRepository = {
      async listSaccos() { return []; },
      async createSacco() {
        const error = new Error('Unique constraint violation.');
        Object.assign(error, { code: 'P2002' });
        throw error;
      },
    };
    const { app } = createTestApi('PLATFORM_ADMIN', saccoRepository);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const response = await request(app)
      .post('/api/v1/saccos')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({
        name: 'Nairobi Riders SACCO',
        registrationNumber: 'CS12345',
        adminFullName: 'SACCO Manager',
        adminPhoneNumber: '+254711111111',
        adminPassword: 'A-unique-temporary-password-937!',
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ALREADY_EXISTS');
  });

  it('lets a new SACCO administrator create an immediately active workspace without an existing account', async () => {
    let provisioned: ProvisionSaccoInput | undefined;
    const record: SaccoSummary = {
      id: 'self-registered-sacco',
      name: 'Westlands Riders SACCO',
      registrationNumber: 'CS12345',
      phoneNumber: '+254722222222',
      operatingArea: 'Nairobi',
      status: 'ACTIVE',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      administrator: {
        id: 'self-registered-admin',
        fullName: 'SACCO Owner',
        phoneNumber: '+254711111111',
      },
    };
    const saccoRepository: SaccoRepository = {
      async listSaccos() { return []; },
      async createSacco(input) {
        provisioned = input;
        return record;
      },
    };
    const { app } = createTestApi('SACCO_ADMIN', saccoRepository);
    const response = await request(app)
      .post('/api/v1/saccos/register')
      .send({
        name: record.name,
        registrationNumber: 'CS 12345',
        phoneNumber: '0722 222 222',
        operatingArea: 'Nairobi',
        adminFullName: record.administrator.fullName,
        adminPhoneNumber: '0711 111 111',
        adminPassword: 'A-unique-workspace-password-937!',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('ACTIVE');
    expect(provisioned?.actor).toBeUndefined();
    expect(provisioned?.registrationNumber).toBe('CS12345');
    expect(provisioned?.phoneNumber).toBe('+254722222222');
    expect(provisioned?.adminPhoneNumber).toBe('+254711111111');
    expect(provisioned?.adminPasswordHash).not.toBe('A-unique-workspace-password-937!');
  });

  it('rejects invalid public SACCO registrations and reports duplicate details', async () => {
    const duplicateRepository: SaccoRepository = {
      async listSaccos() { return []; },
      async createSacco() {
        const error = new Error('Unique constraint violation.');
        Object.assign(error, { code: 'P2002' });
        throw error;
      },
    };
    const { app } = createTestApi('SACCO_ADMIN', duplicateRepository);
    const invalid = await request(app)
      .post('/api/v1/saccos/register')
      .send({
        name: 'Westlands Riders SACCO',
        adminFullName: 'SACCO Owner',
        adminPhoneNumber: 'not-a-phone',
        adminPassword: 'short',
      });
    expect(invalid.status).toBe(400);

    const duplicate = await request(app)
      .post('/api/v1/saccos/register')
      .send({
        name: 'Westlands Riders SACCO',
        adminFullName: 'SACCO Owner',
        adminPhoneNumber: '+254711111111',
        adminPassword: 'A-unique-workspace-password-937!',
      });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('ALREADY_EXISTS');
  });

  it('rate limits repeated public workspace registration attempts', async () => {
    const { app } = createTestApi();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app).post('/api/v1/saccos/register').send({});
      expect(response.status).toBe(400);
    }

    const limited = await request(app).post('/api/v1/saccos/register').send({});
    expect(limited.status).toBe(429);
  });
});

describe('tenant-scoped rider and fleet directory', () => {
  it('derives rider tenant scope from the authenticated SACCO admin', async () => {
    let createInput: CreateRiderInput | undefined;
    let queriedSacco: string | undefined;
    const rider: RiderSummary = {
      id: 'rider-1',
      fullName: 'Rider One',
      phoneNumber: '+254733333333',
      status: 'ACTIVE',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    const directoryRepository: DirectoryRepository = {
      async listRiders(saccoId) {
        queriedSacco = saccoId;
        return { data: [rider], nextCursor: null };
      },
      async createRider(input) {
        createInput = input;
        return rider;
      },
      async listVehicles() { return { data: [], nextCursor: null }; },
      async createVehicle() { throw new Error('Not used in rider test.'); },
    };
    const { app } = createTestApi('SACCO_ADMIN', undefined, directoryRepository);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const authorization = { Authorization: `Bearer ${login.body.accessToken}` };

    const list = await request(app).get('/api/v1/riders?limit=25').set(authorization);
    expect(list.status).toBe(200);
    expect(queriedSacco).toBe('sacco-1');
    expect(list.body.data[0].phoneNumber).toBe('+254733333333');

    const created = await request(app)
      .post('/api/v1/riders')
      .set(authorization)
      .send({
        fullName: 'Rider One',
        phoneNumber: '0733 333 333',
        initialPassword: 'A-unique-rider-password-937!',
        saccoId: 'another-sacco',
      });
    expect(created.status).toBe(400);
    expect(createInput).toBeUndefined();

    const validCreate = await request(app)
      .post('/api/v1/riders')
      .set(authorization)
      .send({
        fullName: 'Rider One',
        phoneNumber: '0733 333 333',
        initialPassword: 'A-unique-rider-password-937!',
      });
    expect(validCreate.status).toBe(201);
    expect(createInput?.saccoId).toBe('sacco-1');
    expect(createInput?.phoneNumber).toBe('+254733333333');
    expect(createInput?.passwordHash).not.toBe('A-unique-rider-password-937!');
  });

  it('scopes vehicle registration to the current SACCO and restricts directory access to SACCO admins', async () => {
    let vehicleInput: CreateVehicleInput | undefined;
    const vehicle: VehicleSummary = {
      id: 'vehicle-1',
      registrationNumber: 'KCA 123A',
      type: 'MOTORCYCLE',
      status: 'ACTIVE',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    const directoryRepository: DirectoryRepository = {
      async listRiders() { return { data: [], nextCursor: null }; },
      async createRider() { throw new Error('Not used in vehicle test.'); },
      async listVehicles(saccoId) {
        expect(saccoId).toBe('sacco-1');
        return { data: [vehicle], nextCursor: null };
      },
      async createVehicle(input) {
        vehicleInput = input;
        return vehicle;
      },
    };
    const { app: adminApp } = createTestApi('SACCO_ADMIN', undefined, directoryRepository);
    const login = await request(adminApp)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const authorization = { Authorization: `Bearer ${login.body.accessToken}` };
    const created = await request(adminApp)
      .post('/api/v1/vehicles')
      .set(authorization)
      .send({ registrationNumber: 'kca 123a', type: 'MOTORCYCLE', saccoId: 'foreign-sacco' });

    expect(created.status).toBe(400);
    const validCreate = await request(adminApp)
      .post('/api/v1/vehicles')
      .set(authorization)
      .send({ registrationNumber: 'kca 123a', type: 'MOTORCYCLE' });
    expect(validCreate.status).toBe(201);
    expect(vehicleInput?.saccoId).toBe('sacco-1');
    expect(vehicleInput?.normalizedRegistration).toBe('KCA123A');

    const { app: riderApp } = createTestApi('RIDER', undefined, directoryRepository);
    const riderLogin = await request(riderApp)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const forbidden = await request(riderApp)
      .get('/api/v1/vehicles')
      .set({ Authorization: `Bearer ${riderLogin.body.accessToken}` });
    expect(forbidden.status).toBe(403);
  });
});

describe('SACCO assignments and rider work sessions', () => {
  const assignment: AssignmentSummary = {
    id: 'assignment-1',
    status: 'ACTIVE',
    assignedAt: new Date('2026-11-05T05:00:00.000Z'),
    unassignedAt: null,
    rider: { id: 'user-1', fullName: 'Test SACCO Admin', phoneNumber },
    vehicle: { id: 'vehicle-1', registrationNumber: 'KCA 123A', type: 'MOTORCYCLE' },
  };
  const session: WorkSessionSummary = {
    id: 'session-1',
    startedAt: new Date('2026-11-05T05:15:00.000Z'),
    endedAt: null,
    status: 'ACTIVE',
    vehicle: assignment.vehicle,
  };

  it('scopes assignments to the admin SACCO and prevents ending an assignment during a shift', async () => {
    let createInput: Parameters<OperationsRepository['createAssignment']>[0] | undefined;
    const operationsRepository: OperationsRepository = {
      async listAssignments(saccoId) {
        expect(saccoId).toBe('sacco-1');
        return [assignment];
      },
      async createAssignment(input) {
        createInput = input;
        return assignment;
      },
      async endAssignment(input) {
        expect(input.saccoId).toBe('sacco-1');
        throw new OperationsRuleError('End the rider’s work session before ending this assignment.', 'CONFLICT');
      },
      async getRiderWorkspace() { return { assignment, workSession: session }; },
      async startWorkSession() { return session; },
      async endWorkSession() { return null; },
      async listTrips() { return []; },
      async startTrip() { throw new Error('Trips are not used in this test.'); },
      async completeTrip() { return null; },
    };
    const { app } = createTestApi('SACCO_ADMIN', undefined, undefined, operationsRepository);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const authorization = { Authorization: ['Bearer', login.body.accessToken].join(' ') };

    const rejected = await request(app)
      .post('/api/v1/assignments')
      .set(authorization)
      .send({ riderId: 'user-1', vehicleId: 'vehicle-1', saccoId: 'another-sacco' });
    expect(rejected.status).toBe(400);
    expect(createInput).toBeUndefined();

    const created = await request(app)
      .post('/api/v1/assignments')
      .set(authorization)
      .send({ riderId: 'user-1', vehicleId: 'vehicle-1' });
    expect(created.status).toBe(201);
    expect(createInput).toEqual({
      riderId: 'user-1',
      vehicleId: 'vehicle-1',
      saccoId: 'sacco-1',
      actorUserId: 'user-1',
    });

    const listed = await request(app).get('/api/v1/assignments').set(authorization);
    expect(listed.status).toBe(200);
    expect(listed.body.data[0].vehicle.registrationNumber).toBe('KCA 123A');

    const ended = await request(app)
      .post('/api/v1/assignments/assignment-1/end')
      .set(authorization);
    expect(ended.status).toBe(409);
    expect(ended.body.error.code).toBe('CONFLICT');
  });

  it('lets only the authenticated rider start and end their own work session', async () => {
    let startScope: { saccoId: string; riderId: string } | undefined;
    let endScope: { saccoId: string; riderId: string; sessionId: string } | undefined;
    const riderWorkspace: RiderWorkspaceSummary = { assignment, workSession: null };
    const operationsRepository: OperationsRepository = {
      async listAssignments() { return []; },
      async createAssignment() { return assignment; },
      async endAssignment() { return null; },
      async getRiderWorkspace(saccoId, riderId) {
        expect(saccoId).toBe('sacco-1');
        expect(riderId).toBe('user-1');
        return riderWorkspace;
      },
      async startWorkSession(saccoId, riderId) {
        startScope = { saccoId, riderId };
        return session;
      },
      async endWorkSession(saccoId, riderId, sessionId) {
        endScope = { saccoId, riderId, sessionId };
        return { ...session, status: 'COMPLETED', endedAt: new Date('2026-11-05T13:00:00.000Z') };
      },
      async listTrips() { return []; },
      async startTrip() { throw new Error('Trips are not used in this test.'); },
      async completeTrip() { return null; },
    };
    const { app } = createTestApi('RIDER', undefined, undefined, operationsRepository);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const authorization = { Authorization: ['Bearer', login.body.accessToken].join(' ') };

    const workspace = await request(app).get('/api/v1/rider/workspace').set(authorization);
    expect(workspace.status).toBe(200);
    expect(workspace.body.data.assignment.vehicle.id).toBe('vehicle-1');
    expect(workspace.body.data.workSession).toBeNull();

    const forbiddenAssignmentList = await request(app).get('/api/v1/assignments').set(authorization);
    expect(forbiddenAssignmentList.status).toBe(403);

    const started = await request(app).post('/api/v1/work-sessions/start').set(authorization);
    expect(started.status).toBe(201);
    expect(startScope).toEqual({ saccoId: 'sacco-1', riderId: 'user-1' });

    const completed = await request(app)
      .post('/api/v1/work-sessions/session-1/end')
      .set(authorization);
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect(endScope).toEqual({ saccoId: 'sacco-1', riderId: 'user-1', sessionId: 'session-1' });
  });

  it('does not allow administrators to start rider work sessions', async () => {
    const { app } = createTestApi();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const response = await request(app)
      .post('/api/v1/work-sessions/start')
      .set({ Authorization: ['Bearer', login.body.accessToken].join(' ') });

    expect(response.status).toBe(403);
  });

  it('records trips and fares only for the authenticated rider with idempotent starts', async () => {
    const trip: TripSummary = {
      id: 'trip-1',
      startedAt: new Date('2026-11-05T05:30:00.000Z'),
      endedAt: null,
      fareAmount: null,
      status: 'IN_PROGRESS',
      vehicle: assignment.vehicle,
    };
    let startInput: { saccoId: string; riderId: string; idempotencyKey: string } | undefined;
    let completionInput: { saccoId: string; riderId: string; tripId: string; fareAmount: string } | undefined;
    const operationsRepository: OperationsRepository = {
      async listAssignments() { return []; },
      async createAssignment() { return assignment; },
      async endAssignment() { return null; },
      async getRiderWorkspace() { return { assignment, workSession: session }; },
      async startWorkSession() { return session; },
      async endWorkSession() {
        throw new OperationsRuleError('Complete your in-progress trip before ending the work session.', 'CONFLICT');
      },
      async listTrips(saccoId, riderId, limit) {
        expect({ saccoId, riderId, limit }).toEqual({ saccoId: 'sacco-1', riderId: 'user-1', limit: 20 });
        return [trip];
      },
      async startTrip(saccoId, riderId, idempotencyKey) {
        startInput = { saccoId, riderId, idempotencyKey };
        return trip;
      },
      async completeTrip(saccoId, riderId, tripId, fareAmount) {
        completionInput = { saccoId, riderId, tripId, fareAmount };
        return {
          ...trip,
          status: 'COMPLETED',
          endedAt: new Date('2026-11-05T05:45:00.000Z'),
          fareAmount,
        };
      },
    };
    const { app } = createTestApi('RIDER', undefined, undefined, operationsRepository);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const authorization = { Authorization: ['Bearer', login.body.accessToken].join(' ') };

    const history = await request(app)
      .get('/api/v1/trips?limit=20')
      .set(authorization);
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].vehicle.registrationNumber).toBe('KCA 123A');

    const invalidLimit = await request(app).get('/api/v1/trips?limit=101').set(authorization);
    expect(invalidLimit.status).toBe(400);

    const missingKey = await request(app).post('/api/v1/trips/start').set(authorization);
    expect(missingKey.status).toBe(400);

    const started = await request(app)
      .post('/api/v1/trips/start')
      .set({ ...authorization, 'Idempotency-Key': 'trip-start-key-0001' });
    expect(started.status).toBe(201);
    expect(startInput).toEqual({
      saccoId: 'sacco-1',
      riderId: 'user-1',
      idempotencyKey: 'trip-start-key-0001',
    });

    const blockedShiftEnd = await request(app)
      .post('/api/v1/work-sessions/session-1/end')
      .set(authorization);
    expect(blockedShiftEnd.status).toBe(409);
    expect(blockedShiftEnd.body.error.code).toBe('CONFLICT');

    const invalidFare = await request(app)
      .post('/api/v1/trips/trip-1/complete')
      .set(authorization)
      .send({ fareAmount: '125.555' });
    expect(invalidFare.status).toBe(400);
    expect(completionInput).toBeUndefined();

    const completed = await request(app)
      .post('/api/v1/trips/trip-1/complete')
      .set(authorization)
      .send({ fareAmount: '125.5' });
    expect(completed.status).toBe(200);
    expect(completed.body.data.fareAmount).toBe('125.50');
    expect(completionInput).toEqual({
      saccoId: 'sacco-1',
      riderId: 'user-1',
      tripId: 'trip-1',
      fareAmount: '125.50',
    });
  });

  it('does not allow administrators to view rider trip history', async () => {
    const { app } = createTestApi();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const response = await request(app)
      .get('/api/v1/trips')
      .set({ Authorization: ['Bearer', login.body.accessToken].join(' ') });

    expect(response.status).toBe(403);
  });

  it('lets riders search and request prototype road routes', async () => {
    const mapsRepository: MapsRepository = {
      async searchPlaces(input) {
        expect(input).toBe('Westlands');
        return [{
          placeId: 'place-1',
          description: 'Westlands, Nairobi, Kenya',
          latitude: -1.2676,
          longitude: 36.8108,
        }];
      },
      async getRoutes(origin, destination) {
        expect(origin).toEqual({ latitude: -1.2864, longitude: 36.8172 });
        expect(destination).toEqual({ latitude: -1.2676, longitude: 36.8108 });
        return [{
          id: 'route-1',
          distanceMeters: 3200,
          durationSeconds: 480,
          encodedPolyline: 'abc123',
        }];
      },
      async getTile() {
        return {
          body: new Uint8Array([137, 80, 78, 71]),
          contentType: 'image/png',
          cacheControl: 'public, max-age=86400',
          etag: '"tile"',
          expires: null,
          lastModified: null,
        };
      },
    };
    const { app } = createTestApi('RIDER', undefined, undefined, undefined, mapsRepository);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const authorization = { Authorization: ['Bearer', login.body.accessToken].join(' ') };

    const suggestions = await request(app)
      .get('/api/v1/maps/places?input=Westlands')
      .set(authorization);
    expect(suggestions.status).toBe(200);
    expect(suggestions.body.data[0].placeId).toBe('place-1');
    expect(suggestions.body.data[0].latitude).toBe(-1.2676);

    const routes = await request(app)
      .post('/api/v1/maps/routes')
      .set(authorization)
      .send({
        origin: { latitude: -1.2864, longitude: 36.8172 },
        destination: { latitude: -1.2676, longitude: 36.8108 },
      });
    expect(routes.status).toBe(200);
    expect(routes.body.data[0].distanceMeters).toBe(3200);

    const tile = await request(app).get('/api/v1/maps/tiles/12/2341/1420');
    expect(tile.status).toBe(200);
    expect(tile.headers['content-type']).toContain('image/png');
    expect(tile.headers['cache-control']).toBe('public, max-age=86400');
    expect(tile.headers.etag).toBe('"tile"');

    const invalidTile = await request(app).get('/api/v1/maps/tiles/12/4096/0');
    expect(invalidTile.status).toBe(400);

    const invalidCoordinates = await request(app)
      .post('/api/v1/maps/routes')
      .set(authorization)
      .send({ origin: { latitude: 300, longitude: 36 }, destination: { latitude: 0, longitude: 0 } });
    expect(invalidCoordinates.status).toBe(400);
  });

  it('keeps map search and routes restricted to riders', async () => {
    const { app } = createTestApi();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const response = await request(app)
      .get('/api/v1/maps/places?input=Nairobi')
      .set({ Authorization: ['Bearer', login.body.accessToken].join(' ') });

    expect(response.status).toBe(403);
  });

  it('does not expose provider configuration or upstream failures to clients', async () => {
    const mapsRepository: MapsRepository = {
      async searchPlaces() { throw new MapsServiceError('The public map service could not be reached.', 'UPSTREAM_ERROR', 502); },
      async getRoutes() { return []; },
      async getTile() { throw new MapsServiceError('OpenStreetMap could not provide this map tile.', 'UPSTREAM_ERROR', 502); },
    };
    const { app } = createTestApi('RIDER', undefined, undefined, undefined, mapsRepository);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phoneNumber, password });
    const response = await request(app)
      .get('/api/v1/maps/places?input=Nairobi')
      .set({ Authorization: ['Bearer', login.body.accessToken].join(' ') });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('UPSTREAM_ERROR');
    expect(response.text).not.toContain('API_KEY');
  });
});
