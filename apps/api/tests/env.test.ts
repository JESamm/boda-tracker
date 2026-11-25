import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const databaseUrl = 'postgresql://test:test@localhost:5432/test';

describe('API environment validation', () => {
  it('requires an access-token secret in production', () => {
    expect(() => loadEnv({
      APP_ENV: 'production',
      DATABASE_URL: databaseUrl,
    })).toThrow('AUTH_ACCESS_TOKEN_SECRET must be set in production.');
  });

  it('rejects production secrets shorter than 32 characters', () => {
    expect(() => loadEnv({
      APP_ENV: 'production',
      DATABASE_URL: databaseUrl,
      AUTH_ACCESS_TOKEN_SECRET: 'too-short',
    })).toThrow();
  });

  it('uses a unique ephemeral secret for development when none is configured', () => {
    const first = loadEnv({ APP_ENV: 'development', DATABASE_URL: databaseUrl });
    const second = loadEnv({ APP_ENV: 'development', DATABASE_URL: databaseUrl });
    expect(first.AUTH_ACCESS_TOKEN_SECRET).toHaveLength(43);
    expect(first.AUTH_ACCESS_TOKEN_SECRET).not.toBe(second.AUTH_ACCESS_TOKEN_SECRET);
  });

  it('accepts empty optional Brevo values in the environment example', () => {
    const env = loadEnv({
      APP_ENV: 'development',
      DATABASE_URL: databaseUrl,
      BREVO_API_KEY: '',
      BREVO_SENDER_EMAIL: '',
      BREVO_SENDER_NAME: 'Boda-Tracker',
    });

    expect(env.BREVO_SENDER_EMAIL).toBeUndefined();
  });

});
