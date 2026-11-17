import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { apiBaseUrl, isSameOrigin, setSessionCookies } from '../login/route';

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'The request origin is not allowed.' } },
      { status: 403 },
    );
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get('boda_access')?.value;
  const refreshToken = cookieStore.get('boda_refresh')?.value;

  if (accessToken) {
    const current = await fetch(`${apiBaseUrl()}/auth/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }).catch((error: unknown) => {
      console.error('Dashboard session check could not reach the API.', error);
      return null;
    });

    if (!current) {
      return apiUnavailable();
    }
    if (current.ok) {
      return NextResponse.json(await current.json());
    }
    if (current.status !== 401) {
      return NextResponse.json(
        { error: { code: 'SESSION_CHECK_FAILED', message: 'The session could not be verified.' } },
        { status: 502 },
      );
    }
  }

  if (!refreshToken) {
    const response = NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
      { status: 401 },
    );
    clearSessionCookies(response);
    return response;
  }

  const refreshed = await fetch(`${apiBaseUrl()}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  }).catch((error: unknown) => {
    console.error('Dashboard session refresh could not reach the API.', error);
    return null;
  });

  if (!refreshed) {
    return apiUnavailable();
  }
  const payload = await refreshed.json().catch(() => null) as SessionResponse | null;
  if (!refreshed.ok || !payload?.accessToken || !payload.refreshToken || !payload.user) {
    const response = NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Your session expired. Sign in again.' } },
      { status: 401 },
    );
    clearSessionCookies(response);
    return response;
  }

  const response = NextResponse.json({ user: payload.user });
  setSessionCookies(response, payload);
  return response;
}

interface SessionResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: {
    id: string;
    fullName: string;
    phoneNumber: string;
    role: string;
    saccoId: string | null;
    saccoName: string | null;
  };
}

function clearSessionCookies(response: NextResponse) {
  response.cookies.delete('boda_access');
  response.cookies.delete('boda_refresh');
}

function apiUnavailable() {
  return NextResponse.json(
    { error: { code: 'API_UNAVAILABLE', message: 'The sign-in service is unavailable. Try again shortly.' } },
    { status: 503 },
  );
}
