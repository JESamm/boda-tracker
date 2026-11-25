import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createAuthRouter, type AuthRepository } from './auth/auth.js';
import { createDirectoryRouter, type DirectoryRepository } from './resources/directory.js';
import { createMapsRouter, type MapsRepository } from './resources/maps.js';
import { createOperationsRouter, type OperationsRepository } from './resources/operations.js';
import { createSaccoRouter, type SaccoRepository } from './resources/saccos.js';
import type { SmsSender } from './sms/africas-talking.js';
import type { EmailSender } from './email/brevo.js';

export interface HealthDatabase {
  ping(): Promise<void>;
}

interface CreateAppOptions {
  allowedOrigins: string[];
  database: HealthDatabase;
  auth: AuthRepository;
  saccos: SaccoRepository;
  directory: DirectoryRepository;
  maps: MapsRepository;
  operations: OperationsRepository;
  accessTokenSecret: string;
  smsSender?: SmsSender;
  emailSender?: EmailSender;
}

export function createApp({
  allowedOrigins,
  database,
  auth,
  saccos,
  directory,
  maps,
  operations,
  accessTokenSecret,
  smsSender,
  emailSender,
}: CreateAppOptions): Express {
  const app = express();
  const outboundSms = smsSender ?? {
    async send() {
      throw new Error('No SMS sender is configured for this application instance.');
    },
  };
  const outboundEmail = emailSender ?? {
    async sendVerificationCode() {
      throw new Error('No email sender is configured for this application instance.');
    },
  };

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({
    origin: allowedOrigins,
    credentials: true,
  }));
  app.use(express.json({ limit: '64kb' }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  app.use('/api/v1/auth', authLimiter);
  app.use('/api/v1/auth/activation/request', rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }));
  app.use('/api/v1/auth/password/change/request', rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }));
  app.use('/api/v1/auth/email/verification/request', rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }));
  app.use('/api/v1/auth', createAuthRouter(auth, accessTokenSecret, outboundSms, outboundEmail));
  app.use('/api/v1/saccos/register', rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }));
  app.use('/api/v1/saccos', createSaccoRouter(auth, saccos, accessTokenSecret, outboundEmail));
  app.use('/api/v1/maps', rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (request) => request.path.startsWith('/tiles/'),
  }));
  app.use('/api/v1/maps/tiles', rateLimit({
    windowMs: 60 * 1000,
    limit: 1200,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }));
  app.use('/api/v1/maps', createMapsRouter(auth, maps, accessTokenSecret));
  app.use('/api/v1', createDirectoryRouter(auth, directory, accessTokenSecret, outboundEmail));
  app.use('/api/v1', createOperationsRouter(auth, operations, accessTokenSecret));

  app.get('/health/live', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.get('/api/v1/health/ready', async (_request, response) => {
    try {
      await database.ping();
      response.status(200).json({ status: 'ready', database: 'connected' });
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Database readiness check failed',
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }));
      response.status(503).json({ status: 'not_ready', database: 'unavailable' });
    }
  });

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      },
    });
  });

  app.use((error: unknown, request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const errorType = isErrorType(error) ? error.type : undefined;
    const status = errorType === 'entity.too.large'
      ? 413
      : error instanceof SyntaxError
        ? 400
        : 500;
    const code = status === 413
      ? 'PAYLOAD_TOO_LARGE'
      : status === 400
        ? 'INVALID_JSON'
        : 'INTERNAL_ERROR';

    if (status === 500) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Unhandled request error',
        method: request.method,
        path: request.path,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }));
    }

    response.status(status).json({
      error: {
        code,
        message: status === 500
          ? 'An unexpected error occurred.'
          : status === 413
            ? 'The request payload is too large.'
            : 'The request body must contain valid JSON.',
      },
    });
  });

  return app;
}

function isErrorType(error: unknown): error is Error & { type: string } {
  return error instanceof Error
    && 'type' in error
    && typeof error.type === 'string';
}
