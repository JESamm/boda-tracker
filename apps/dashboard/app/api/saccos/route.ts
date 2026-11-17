import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiBaseUrl, isSameOrigin } from '../auth/login/route';

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  registrationNumber: z.preprocess(
    (value) => typeof value === 'string' && !value.trim() ? undefined : value,
    z.string().trim().min(3).max(40).optional(),
  ),
  phoneNumber: z.string().trim().max(20).optional(),
  operatingArea: z.string().trim().max(120).optional(),
  adminFullName: z.string().trim().min(2).max(100),
  adminPhoneNumber: z.string().trim().min(7).max(20),
  adminPassword: z.string().min(14).max(128),
}).strict();

export async function GET() {
  const accessToken = (await cookies()).get('boda_access')?.value;
  if (!accessToken) return unauthenticated();

  const upstream = await fetch(`${apiBaseUrl()}/saccos`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  }).catch((error: unknown) => {
    console.error('SACCO list request could not reach the API.', error);
    return null;
  });

  if (!upstream) return apiUnavailable();
  return proxyResponse(upstream);
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'The request origin is not allowed.' } },
      { status: 403 },
    );
  }

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'Check SACCO and administrator details. Passwords must be at least 14 characters.' } },
      { status: 400 },
    );
  }

  const accessToken = (await cookies()).get('boda_access')?.value;
  if (!accessToken) return unauthenticated();

  const upstream = await fetch(`${apiBaseUrl()}/saccos`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body.data),
    cache: 'no-store',
  }).catch((error: unknown) => {
    console.error('SACCO creation request could not reach the API.', error);
    return null;
  });

  if (!upstream) return apiUnavailable();
  return proxyResponse(upstream);
}

async function proxyResponse(upstream: Response) {
  const payload = await upstream.json().catch(() => null);
  if (!payload) {
    return NextResponse.json(
      { error: { code: 'INVALID_API_RESPONSE', message: 'The API returned an invalid response.' } },
      { status: 502 },
    );
  }
  return NextResponse.json(payload, { status: upstream.status });
}

function unauthenticated() {
  return NextResponse.json(
    { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
    { status: 401 },
  );
}

function apiUnavailable() {
  return NextResponse.json(
    { error: { code: 'API_UNAVAILABLE', message: 'The API is unavailable. Try again shortly.' } },
    { status: 503 },
  );
}
