import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticateRequest, requireRoles, type AuthRepository } from '../auth/auth.js';

export interface MapCoordinate {
  latitude: number;
  longitude: number;
}

export interface PlaceSuggestion extends MapCoordinate {
  placeId: string;
  description: string;
}

export interface RouteOption {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
}

export interface MapTile {
  body: Uint8Array;
  contentType: string;
  cacheControl: string;
  etag: string | null;
  expires: string | null;
  lastModified: string | null;
}

export interface MapsRepository {
  searchPlaces(input: string, location?: MapCoordinate): Promise<PlaceSuggestion[]>;
  getRoutes(origin: MapCoordinate, destination: MapCoordinate): Promise<RouteOption[]>;
  getTile(z: number, x: number, y: number): Promise<MapTile>;
}

export class MapsServiceError extends Error {
  constructor(
    message: string,
    readonly code: 'UNAVAILABLE' | 'UPSTREAM_ERROR',
    readonly status: 503 | 502,
  ) {
    super(message);
    this.name = 'MapsServiceError';
  }
}

const coordinateSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
}).strict();

export function createPublicMapsRepository(fetcher: typeof fetch = fetch): MapsRepository {
  async function getJson(url: string): Promise<unknown> {
    let response: globalThis.Response;
    try {
      response = await fetcher(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'BodaTrackerRider/0.1.0',
        },
      });
    } catch {
      throw new MapsServiceError('The public map service could not be reached. Try again shortly.', 'UPSTREAM_ERROR', 502);
    }
    if (!response.ok) {
      throw new MapsServiceError('The public map service could not complete this request.', 'UPSTREAM_ERROR', 502);
    }
    try {
      return await response.json();
    } catch {
      throw new MapsServiceError('The public map service returned an unreadable response.', 'UPSTREAM_ERROR', 502);
    }
  }

  return {
    async searchPlaces(input, location) {
      const url = new URL('https://photon.komoot.io/api/');
      url.searchParams.set('q', input);
      url.searchParams.set('limit', '5');
      url.searchParams.set('lang', 'en');
      if (location) {
        url.searchParams.set('lat', String(location.latitude));
        url.searchParams.set('lon', String(location.longitude));
        url.searchParams.set('zoom', '14');
      }

      const parsed = z.object({
        features: z.array(z.object({
          geometry: z.object({
            coordinates: z.tuple([z.number().finite(), z.number().finite()]),
          }),
          properties: z.object({
            osm_id: z.union([z.number(), z.string()]).optional(),
            osm_type: z.string().optional(),
            name: z.string().optional(),
            street: z.string().optional(),
            housenumber: z.string().optional(),
            city: z.string().optional(),
            district: z.string().optional(),
            county: z.string().optional(),
            state: z.string().optional(),
            country: z.string().optional(),
          }).passthrough(),
        })).optional(),
      }).safeParse(await getJson(url.toString()));
      if (!parsed.success) {
        throw new MapsServiceError('The public place search returned an unexpected response.', 'UPSTREAM_ERROR', 502);
      }

      return (parsed.data.features ?? []).flatMap((feature, index) => {
        const [longitude, latitude] = feature.geometry.coordinates;
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return [];
        const properties = feature.properties;
        const street = [properties.housenumber, properties.street].filter(Boolean).join(' ');
        const description = [...new Set([
          properties.name,
          street,
          properties.city,
          properties.district,
          properties.county,
          properties.state,
          properties.country,
        ].filter((part): part is string => Boolean(part)))].join(', ');
        if (!description) return [];
        return [{
          placeId: `${properties.osm_type ?? 'place'}-${properties.osm_id ?? index}`,
          description,
          latitude,
          longitude,
        }];
      }).slice(0, 5);
    },
    async getRoutes(origin, destination) {
      const coordinates = [
        `${origin.longitude},${origin.latitude}`,
        `${destination.longitude},${destination.latitude}`,
      ].join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=polyline&alternatives=3&steps=false`;
      const parsed = z.object({
        code: z.string(),
        routes: z.array(z.object({
          distance: z.number().finite().nonnegative(),
          duration: z.number().finite().nonnegative(),
          geometry: z.string().min(1),
        })).optional(),
      }).safeParse(await getJson(url));
      if (!parsed.success) {
        throw new MapsServiceError('The public route service returned an unexpected response.', 'UPSTREAM_ERROR', 502);
      }
      if (parsed.data.code !== 'Ok') return [];
      return (parsed.data.routes ?? [])
        .map((route, index) => ({
          id: `route-${index + 1}`,
          distanceMeters: Math.round(route.distance),
          durationSeconds: Math.ceil(route.duration),
          encodedPolyline: route.geometry,
        }))
        .sort((left, right) => left.distanceMeters - right.distanceMeters)
        .slice(0, 3);
    },
    async getTile(z, x, y) {
      let response: globalThis.Response;
      try {
        response = await fetcher(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
          headers: {
            accept: 'image/png',
            'user-agent': 'BodaTrackerRider/0.1.0',
          },
        });
      } catch {
        throw new MapsServiceError('OpenStreetMap tiles could not be reached. Try again shortly.', 'UPSTREAM_ERROR', 502);
      }
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
      if (!response.ok || contentType !== 'image/png') {
        throw new MapsServiceError('OpenStreetMap could not provide this map tile.', 'UPSTREAM_ERROR', 502);
      }
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.length > 1_000_000) {
        throw new MapsServiceError('OpenStreetMap returned an oversized map tile.', 'UPSTREAM_ERROR', 502);
      }
      return {
        body,
        contentType,
        cacheControl: response.headers.get('cache-control') ?? 'public, max-age=604800',
        etag: response.headers.get('etag'),
        expires: response.headers.get('expires'),
        lastModified: response.headers.get('last-modified'),
      };
    },
  };
}

export function createMapsRouter(
  authRepository: AuthRepository,
  mapsRepository: MapsRepository,
  accessTokenSecret: string,
): Router {
  const router = Router();
  const authenticate = authenticateRequest(authRepository, accessTokenSecret);
  const authorizeRider = requireRoles('RIDER');

  router.get('/tiles/:z/:x/:y', async (request, response) => {
    const zValue = parseTileCoordinate(request.params.z, 19);
    const xValue = parseTileCoordinate(request.params.x, zValue === null ? 0 : 2 ** zValue - 1);
    const yValue = parseTileCoordinate(request.params.y, zValue === null ? 0 : 2 ** zValue - 1);
    if (zValue === null || xValue === null || yValue === null) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Provide valid map tile coordinates.' },
      });
      return;
    }

    try {
      const tile = await mapsRepository.getTile(zValue, xValue, yValue);
      response.setHeader('content-type', tile.contentType);
      response.setHeader('cache-control', tile.cacheControl);
      if (tile.etag) response.setHeader('etag', tile.etag);
      if (tile.expires) response.setHeader('expires', tile.expires);
      if (tile.lastModified) response.setHeader('last-modified', tile.lastModified);
      response.status(200).send(Buffer.from(tile.body));
    } catch (error) {
      if (error instanceof MapsServiceError) {
        response.status(error.status).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }
      throw error;
    }
  });

  router.get('/places', authenticate, authorizeRider, async (request, response) => {
    const rawInput = request.query.input;
    const input = typeof rawInput === 'string' ? rawInput.trim() : '';
    const rawLatitude = request.query.latitude;
    const rawLongitude = request.query.longitude;
    const hasLocation = rawLatitude !== undefined || rawLongitude !== undefined;
    let location: MapCoordinate | undefined;
    if (hasLocation) {
      const parsedLocation = coordinateSchema.safeParse({
        latitude: typeof rawLatitude === 'string' ? Number(rawLatitude) : Number.NaN,
        longitude: typeof rawLongitude === 'string' ? Number(rawLongitude) : Number.NaN,
      });
      if (!parsedLocation.success) {
        response.status(400).json({
          error: { code: 'INVALID_REQUEST', message: 'Provide valid location coordinates for place search.' },
        });
        return;
      }
      location = parsedLocation.data;
    }

    if (input.length < 3 || input.length > 120) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Place search must contain between 3 and 120 characters.' },
      });
      return;
    }

    await respondWithMapsResult(response, async () => ({
      data: await mapsRepository.searchPlaces(input, location),
    }));
  });

  router.post('/routes', authenticate, authorizeRider, async (request, response) => {
    const input = z.object({
      origin: coordinateSchema,
      destination: coordinateSchema,
    }).strict().safeParse(request.body);
    if (!input.success) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Provide valid current and destination map coordinates.' },
      });
      return;
    }

    await respondWithMapsResult(response, async () => ({
      data: await mapsRepository.getRoutes(input.data.origin, input.data.destination),
    }));
  });

  return router;
}

function parseTileCoordinate(value: string | string[] | undefined, maximum: number): number | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,5})$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed <= maximum ? parsed : null;
}

async function respondWithMapsResult(
  response: Response,
  operation: () => Promise<{ data: unknown } | null>,
): Promise<void> {
  try {
    const result = await operation();
    if (result) response.status(200).json(result);
  } catch (error) {
    if (error instanceof MapsServiceError) {
      response.status(error.status).json({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    throw error;
  }
}
