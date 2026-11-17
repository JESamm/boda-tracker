import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { apiBaseUrl, isSameOrigin } from '../login/route';

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'The request origin is not allowed.' } },
      { status: 403 },
    );
  }

  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('boda_refresh')?.value;
  if (refreshToken) {
    const upstream = await fetch(`${apiBaseUrl()}/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch((error: unknown) => {
      console.error('Dashboard sign-out could not reach the API.', error);
      return null;
    });

    if (!upstream || !upstream.ok) {
      return NextResponse.json(
        { error: { code: 'SIGN_OUT_FAILED', message: 'Could not revoke the session. Try again when the service is available.' } },
        { status: 503 },
      );
    }
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.delete('boda_access');
  response.cookies.delete('boda_refresh');
  return response;
}
