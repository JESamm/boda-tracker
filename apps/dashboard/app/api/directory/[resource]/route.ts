import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiBaseUrl, isSameOrigin } from '../../auth/login/route';

const riderSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phoneNumber: z.string().trim().min(7).max(20),
  email: z.string().trim().email().max(254),
}).strict();

const vehicleSchema = z.object({
  registrationNumber: z.string().trim().min(3).max(20),
  type: z.enum(['MOTORCYCLE', 'MATATU']),
}).strict();

const assignmentSchema = z.object({
  riderId: z.string().min(1).max(64),
  vehicleId: z.string().min(1).max(64),
}).strict();

type DirectoryResource = 'riders' | 'vehicles' | 'assignments';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  const { resource } = await context.params;
  if (!isDirectoryResource(resource)) return notFound();

  const accessToken = (await cookies()).get('boda_access')?.value;
  if (!accessToken) return unauthenticated();

  const query = new URL(request.url).searchParams;
  const upstreamUrl = new URL(`${apiBaseUrl()}/${resource}`);
  const limit = query.get('limit');
  const cursor = query.get('cursor');
  if (limit) upstreamUrl.searchParams.set('limit', limit);
  if (cursor) upstreamUrl.searchParams.set('cursor', cursor);

  const upstream = await fetch(upstreamUrl, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  }).catch((error: unknown) => {
    console.error('Directory list request could not reach the API.', error);
    return null;
  });

  if (!upstream) return apiUnavailable();
  return proxyResponse(upstream);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'The request origin is not allowed.' } },
      { status: 403 },
    );
  }

  const { resource } = await context.params;
  if (!isDirectoryResource(resource)) return notFound();
  const schema = resource === 'riders'
    ? riderSchema
    : resource === 'vehicles'
      ? vehicleSchema
      : assignmentSchema;
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'Check the required directory entry fields.' } },
      { status: 400 },
    );
  }

  const accessToken = (await cookies()).get('boda_access')?.value;
  if (!accessToken) return unauthenticated();

  const upstream = await fetch(`${apiBaseUrl()}/${resource}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body.data),
    cache: 'no-store',
  }).catch((error: unknown) => {
    console.error('Directory create request could not reach the API.', error);
    return null;
  });

  if (!upstream) return apiUnavailable();
  return proxyResponse(upstream);
}

function isDirectoryResource(resource: string): resource is DirectoryResource {
  return resource === 'riders' || resource === 'vehicles' || resource === 'assignments';
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
