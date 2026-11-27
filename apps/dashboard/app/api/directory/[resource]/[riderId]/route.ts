import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiBaseUrl, isSameOrigin } from '../../../auth/login/route';

const updateRiderSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phoneNumber: z.string().trim().min(7).max(20),
  email: z.string().trim().email().max(254).nullable(),
}).strict();

type RouteContext = { params: Promise<{ resource: string; riderId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'The request origin is not allowed.' } },
      { status: 403 },
    );
  }

  const { resource, riderId } = await context.params;
  if (resource !== 'riders' || !z.string().min(1).max(64).safeParse(riderId).success) {
    return notFound();
  }

  const body = updateRiderSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'Check the rider name, Kenyan phone number, and email address.' } },
      { status: 400 },
    );
  }

  const accessToken = (await cookies()).get('boda_access')?.value;
  if (!accessToken) return unauthenticated();

  const upstream = await fetch(`${apiBaseUrl()}/riders/${encodeURIComponent(riderId)}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body.data),
    cache: 'no-store',
  }).catch((error: unknown) => {
    console.error('Rider update request could not reach the API.', error);
    return null;
  });

  if (!upstream) return apiUnavailable();
  return proxyResponse(upstream);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'The request origin is not allowed.' } },
      { status: 403 },
    );
  }

  const { resource, riderId } = await context.params;
  if (resource !== 'riders' || !z.string().min(1).max(64).safeParse(riderId).success) {
    return notFound();
  }

  const accessToken = (await cookies()).get('boda_access')?.value;
  if (!accessToken) return unauthenticated();

  const upstream = await fetch(`${apiBaseUrl()}/riders/${encodeURIComponent(riderId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  }).catch((error: unknown) => {
    console.error('Rider deactivation request could not reach the API.', error);
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

function notFound() {
  return NextResponse.json(
    { error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } },
    { status: 404 },
  );
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
