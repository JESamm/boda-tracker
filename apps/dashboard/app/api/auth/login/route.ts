import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

const loginSchema = z.union([
  z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) }).strict(),
  z.object({ phoneNumber: z.string().trim().min(7).max(20), password: z.string().min(1).max(128) }).strict(),
]);

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'The request origin is not allowed.' } },
      { status: 403 },
    );
  }

  const body = loginSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'Enter a valid email address or phone number and password.' } },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
      cache: 'no-store',
    });
  } catch (error) {
    console.error('Dashboard sign-in could not reach the API.', error);
    return NextResponse.json(
      { error: { code: 'API_UNAVAILABLE', message: 'The sign-in service is unavailable. Try again shortly.' } },
      { status: 503 },
    );
  }

  const payload = await upstream.json().catch(() => null) as LoginResponse | null;
  if (upstream.status === 202 && payload?.verificationRequired) {
    return NextResponse.json({
      verificationRequired: true,
      verificationChannel: payload.verificationChannel,
      message: payload.message,
    }, { status: 202 });
  }
  if (!upstream.ok || !payload?.accessToken || !payload.refreshToken || !payload.user) {
    return NextResponse.json(
      payload?.error ?? { code: 'SIGN_IN_FAILED', message: 'Sign-in failed. Check your details and try again.' },
      { status: upstream.status || 502 },
    );
  }

  const response = NextResponse.json({ user: payload.user });
  setSessionCookies(response, payload);
  return response;
}

interface LoginResponse {
  accessToken?: string;
  expiresIn?: number;
  refreshToken?: string;
  verificationRequired?: boolean;
  verificationChannel?: 'email' | 'phone';
  message?: string;
  user?: {
    id: string;
    fullName: string;
    phoneNumber: string;
    email: string | null;
    emailVerified: boolean;
    role: string;
    saccoId: string | null;
    saccoName: string | null;
  };
  error?: { code: string; message: string };
}

export function setSessionCookies(
  response: NextResponse,
  payload: Pick<LoginResponse, 'accessToken' | 'refreshToken' | 'expiresIn'>,
) {
  if (!payload.accessToken || !payload.refreshToken || !payload.expiresIn) {
    throw new Error('Cannot create dashboard session cookies without a complete auth session.');
  }
  const secure = process.env.NODE_ENV === 'production';
  response.cookies.set('boda_access', payload.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: payload.expiresIn,
  });
  response.cookies.set('boda_refresh', payload.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
}

export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto')
    ?.split(',')[0]
    .trim() ?? new URL(request.url).protocol.slice(0, -1);
  if (!origin || !host) return false;

  try {
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

export function apiBaseUrl(): string {
  const configuredUrl = (
    process.env.API_BASE_URL
    ?? process.env.NEXT_PUBLIC_API_BASE_URL
    ?? 'http://localhost:3001/api/v1'
  );
  const urlWithProtocol = /^https?:\/\//i.test(configuredUrl)
    ? configuredUrl
    : `https://${configuredUrl}`;
  const baseUrl = urlWithProtocol.replace(/\/+$/, '');
  return baseUrl.endsWith('/api/v1') ? baseUrl : `${baseUrl}/api/v1`;
}
