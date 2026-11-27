import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiBaseUrl, isSameOrigin } from '../../../../auth/login/route';

type RouteContext = { params: Promise<{ resource: string; riderId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'The request origin is not allowed.' } },
      { status: 403 },
    );
  }

  const { resource, riderId } = await context.params;
  if (resource !== 'riders' || !z.string().min(1).max(64).safeParse(riderId).success) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } },
      { status: 404 },
    );
  }

  const accessToken = (await cookies()).get('boda_access')?.value;
  if (!accessToken) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
      { status: 401 },
    );
  }

  const upstream = await fetch(`${apiBaseUrl()}/riders/${encodeURIComponent(riderId)}/account`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  }).catch((error: unknown) => {
    console.error('Rider account anonymization request could not reach the API.', error);
    return null;
  });

  if (!upstream) {
    return NextResponse.json(
      { error: { code: 'API_UNAVAILABLE', message: 'The API is unavailable. Try again shortly.' } },
      { status: 503 },
    );
  }

  const payload = await upstream.json().catch(() => null);
  if (!payload) {
    return NextResponse.json(
      { error: { code: 'INVALID_API_RESPONSE', message: 'The API returned an invalid response.' } },
      { status: 502 },
    );
  }
  return NextResponse.json(payload, { status: upstream.status });
}
