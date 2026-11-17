import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { apiBaseUrl, isSameOrigin } from '../../../../auth/login/route';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'The request origin is not allowed.' } },
      { status: 403 },
    );
  }

  const { assignmentId } = await context.params;
  if (!assignmentId || assignmentId.length > 64) {
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'Provide a valid assignment.' } },
      { status: 400 },
    );
  }

  const accessToken = (await cookies()).get('boda_access')?.value;
  if (!accessToken) return unauthenticated();

  const upstream = await fetch(`${apiBaseUrl()}/assignments/${encodeURIComponent(assignmentId)}/end`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + accessToken },
    cache: 'no-store',
  }).catch((error: unknown) => {
    console.error('Assignment update request could not reach the API.', error);
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

function unauthenticated() {
  return NextResponse.json(
    { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
    { status: 401 },
  );
}
