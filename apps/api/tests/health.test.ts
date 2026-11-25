import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { AuthRepository } from '../src/auth/auth.js';
import type { DirectoryRepository } from '../src/resources/directory.js';
import type { MapsRepository } from '../src/resources/maps.js';
import type { OperationsRepository } from '../src/resources/operations.js';
import type { SaccoRepository } from '../src/resources/saccos.js';

const authRepository: AuthRepository = {
  async findUserByPhone() { return null; },
  async findUserByEmail() { return null; },
  async findUserById() { return null; },
  async findRefreshSession() { return null; },
  async createRefreshSession() {},
  async rotateRefreshSession() { return false; },
  async revokeRefreshSession() {},
  async revokeAllRefreshSessions() {},
  async createVerificationCode() {},
  async findLatestVerificationCode() { return null; },
  async countRecentVerificationCodes() { return 0; },
  async consumeVerificationCode() { return false; },
  async setUserPassword() {},
  async setUserEmail() {},
  async markEmailVerified() {},
};

const saccoRepository: SaccoRepository = {
  async listSaccos() { return []; },
  async createSacco() { throw new Error('Not used by health endpoint tests.'); },
};

const directoryRepository: DirectoryRepository = {
  async listRiders() { return { data: [], nextCursor: null }; },
  async createRider() { throw new Error('Not used by health endpoint tests.'); },
  async listVehicles() { return { data: [], nextCursor: null }; },
  async createVehicle() { throw new Error('Not used by health endpoint tests.'); },
};

const operationsRepository: OperationsRepository = {
  async listAssignments() { return []; },
  async createAssignment() { throw new Error('Not used by health endpoint tests.'); },
  async endAssignment() { throw new Error('Not used by health endpoint tests.'); },
  async getRiderWorkspace() { return { assignment: null, workSession: null }; },
  async startWorkSession() { throw new Error('Not used by health endpoint tests.'); },
  async endWorkSession() { return null; },
  async listTrips() { return []; },
  async startTrip() { throw new Error('Not used by health endpoint tests.'); },
  async completeTrip() { return null; },
};
const mapsRepository: MapsRepository = {
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

function app(database: { ping(): Promise<void> }) {
  return createApp({
    allowedOrigins: ['http://localhost:3000'],
    database,
    auth: authRepository,
    saccos: saccoRepository,
    directory: directoryRepository,
    maps: mapsRepository,
    operations: operationsRepository,
    accessTokenSecret: 'unit-test-secret-not-used-outside-test',
  });
}

describe('health endpoints', () => {
  it('reports liveness without depending on PostgreSQL', async () => {
    const ping = vi.fn<() => Promise<void>>();
    const response = await request(app({ ping })).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(ping).not.toHaveBeenCalled();
  });

  it('reports readiness only when the database responds', async () => {
    const response = await request(app({ ping: async () => undefined })).get('/api/v1/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready', database: 'connected' });
  });

  it('does not expose internal database errors', async () => {
    const response = await request(app({ ping: async () => { throw new Error('database password must not leak'); } }))
      .get('/api/v1/health/ready');

    expect(response.status).toBe(503);
    expect(response.text).not.toContain('database password');
    expect(response.body).toEqual({ status: 'not_ready', database: 'unavailable' });
  });

  it('returns consistent JSON for unknown API routes', async () => {
    const response = await request(app({ ping: async () => undefined })).get('/api/v1/not-implemented');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      },
    });
  });

  it('rejects malformed JSON without returning an internal parser error', async () => {
    const response = await request(app({ ping: async () => undefined }))
      .post('/api/v1/example')
      .set('Content-Type', 'application/json')
      .send('{');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'INVALID_JSON',
        message: 'The request body must contain valid JSON.',
      },
    });
  });
});
