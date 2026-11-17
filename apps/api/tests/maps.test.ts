import { describe, expect, it, vi } from 'vitest';
import { createPublicMapsRepository, MapsServiceError } from '../src/resources/maps.js';

describe('public maps repository', () => {
  it('searches Photon and converts coordinates into place suggestions', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      features: [{
        geometry: { coordinates: [36.8108, -1.2676] },
        properties: {
          osm_id: 123,
          osm_type: 'N',
          name: 'Sarit Centre',
          city: 'Nairobi',
          country: 'Kenya',
        },
      }],
    }), { status: 200 }));
    const maps = createPublicMapsRepository(fetcher);

    const places = await maps.searchPlaces('Sarit Centre');
    const [url, init] = fetcher.mock.calls[0]!;

    expect(places).toEqual([{
      placeId: 'N-123',
      description: 'Sarit Centre, Nairobi, Kenya',
      latitude: -1.2676,
      longitude: 36.8108,
    }]);
    expect(String(url)).toBe('https://photon.komoot.io/api/?q=Sarit+Centre&limit=5&lang=en');
    expect(new Headers(init?.headers).get('user-agent')).toBe('BodaTrackerRider/0.1.0');
  });

  it('requests OSRM alternatives in longitude,latitude order and sorts by distance', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 'Ok',
      routes: [
        { distance: 4200.4, duration: 600, geometry: 'longer' },
        { distance: 3100.2, duration: 480.1, geometry: 'shorter' },
      ],
    }), { status: 200 }));
    const maps = createPublicMapsRepository(fetcher);

    const routes = await maps.getRoutes(
      { latitude: -1.2864, longitude: 36.8172 },
      { latitude: -1.2676, longitude: 36.8108 },
    );
    const [url] = fetcher.mock.calls[0]!;

    expect(String(url)).toBe(
      'https://router.project-osrm.org/route/v1/driving/36.8172,-1.2864;36.8108,-1.2676?overview=full&geometries=polyline&alternatives=3&steps=false',
    );
    expect(routes.map((route) => route.distanceMeters)).toEqual([3100, 4200]);
    expect(routes[0]!.durationSeconds).toBe(481);
    expect(routes[0]!.encodedPolyline).toBe('shorter');
  });

  it('fetches OSM tiles with an identifying user agent and forwards cache metadata', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=86400',
        etag: '"tile-etag"',
      },
    }));
    const maps = createPublicMapsRepository(fetcher);

    const tile = await maps.getTile(12, 2341, 1420);
    const [url, init] = fetcher.mock.calls[0]!;

    expect(String(url)).toBe('https://tile.openstreetmap.org/12/2341/1420.png');
    expect(new Headers(init?.headers).get('user-agent')).toBe('BodaTrackerRider/0.1.0');
    expect(tile).toMatchObject({
      body: new Uint8Array([137, 80, 78, 71]),
      contentType: 'image/png',
      cacheControl: 'public, max-age=86400',
      etag: '"tile-etag"',
    });
  });

  it('sanitizes public-provider errors', async () => {
    const rejected = createPublicMapsRepository(
      vi.fn<typeof fetch>().mockResolvedValue(new Response('secret provider detail', { status: 403 })),
    );
    await expect(rejected.searchPlaces('Nairobi'))
      .rejects.toEqual(expect.objectContaining<Partial<MapsServiceError>>({
        message: 'The public map service could not complete this request.',
        code: 'UPSTREAM_ERROR',
        status: 502,
      }));
  });
});
