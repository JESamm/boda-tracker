import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiBaseUrl, isSameOrigin, setSessionCookies } from '../../../login/route';

const verificationSchema = z.object({
  email: z.string().trim().email().max(254),
  code: z.string().regex(/^\d{6}$/),
}).strict();

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'The request origin is not allowed.' } },
      { status: 403 },
    );
  }
  const body = verificationSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'Enter your email and six-digit verification code.' } },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/auth/login/email/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
      cache: 'no-store',
    });
  } catch (error) {
    console.error('Email sign-in verification could not reach the API.', error);
    return NextResponse.json(
      { error: { code: 'API_UNAVAILABLE', message: 'The sign-in service is unavailable. Try again shortly.' } },
      { status: 503 },
    );
  }

  const payload = await upstream.json().catch(() => null) as LoginResponse | null;
  if (!upstream.ok || !payload?.accessToken || !payload.refreshToken || !payload.expiresIn || !payload.user) {
    return NextResponse.json(
      payload?.error ?? { code: 'SIGN_IN_FAILED', message: 'The verification code was invalid or expired.' },
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
