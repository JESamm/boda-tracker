import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiBaseUrl, isSameOrigin } from '../../login/route';

const emailSchema = z.object({
  email: z.string().trim().email().max(254),
}).strict();

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'The request origin is not allowed.' } },
      { status: 403 },
    );
  }

  const body = emailSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'Enter a valid email address.' } },
      { status: 400 },
    );
  }

  const accessToken = (await cookies()).get('boda_access')?.value;
  if (!accessToken) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
      { status: 401 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/auth/email/add`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body.data),
      cache: 'no-store',
    });
  } catch (error) {
    console.error('Email update request could not reach the API.', error);
    return NextResponse.json(
      { error: { code: 'API_UNAVAILABLE', message: 'The account service is unavailable. Try again shortly.' } },
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
