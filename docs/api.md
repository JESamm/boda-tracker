# API

## Conventions

- Base path: `/api/v1`.
- JSON request/response bodies.
- A standard error object is returned for unknown routes: `{ "error": { "code": "...", "message": "..." } }`.
- Protected routes will authenticate before reading client-supplied record identifiers and will derive SACCO/rider scope from the authenticated principal.
- List routes will use bounded pagination and validated filters.

## Implemented endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health/live` | No | Process liveness; does not depend on PostgreSQL |
| GET | `/api/v1/health/ready` | No | Database readiness; returns 503 when database health check fails |
| POST | `/api/v1/auth/login` | No | Authenticate an active account using its Kenyan phone number and password; issues a short-lived access token and refresh token |
| POST | `/api/v1/auth/refresh` | Refresh token | Atomically rotate the refresh token and issue a new access token |
| POST | `/api/v1/auth/logout` | Refresh token | Revoke the submitted refresh token |
| GET | `/api/v1/auth/me` | Access token | Return the current active account; account and SACCO status are checked on every request |
| POST | `/api/v1/saccos/register` | No | Create an active SACCO workspace and its first SACCO administrator atomically; limited to five registrations per client IP per hour |
| GET | `/api/v1/saccos` | Platform admin | Return a bounded list of SACCOs with their initial administrator |
| POST | `/api/v1/saccos` | Platform admin | Create a SACCO and its initial administrator in one transaction |
| GET | `/api/v1/riders` | SACCO admin | Return a bounded, cursor-paginated list from the authenticated SACCO only |
| POST | `/api/v1/riders` | SACCO admin | Create a rider account in the authenticated SACCO |
| GET | `/api/v1/vehicles` | SACCO admin | Return a bounded, cursor-paginated vehicle list from the authenticated SACCO only |
| POST | `/api/v1/vehicles` | SACCO admin | Register a vehicle to the authenticated SACCO |
| GET | `/api/v1/assignments` | SACCO admin | List SACCO vehicle assignments |
| POST | `/api/v1/assignments` | SACCO admin | Assign one active SACCO vehicle to one active SACCO rider |
| POST | `/api/v1/assignments/:assignmentId/end` | SACCO admin | End an active assignment when its rider has no active work session |
| GET | `/api/v1/rider/workspace` | Rider | Return the authenticated rider's active vehicle assignment and work session |
| POST | `/api/v1/work-sessions/start` | Rider | Start a work session on the rider's active vehicle assignment |
| POST | `/api/v1/work-sessions/:sessionId/end` | Rider | Complete the authenticated rider's active work session when no trip is in progress |
| GET | `/api/v1/trips?limit=50` | Rider | List the authenticated rider's recent trips (limit 1–100) |
| POST | `/api/v1/trips/start` | Rider | Start a trip in the active work session; requires an `Idempotency-Key` header |
| POST | `/api/v1/trips/:tripId/complete` | Rider | Complete the rider's in-progress trip and record a fare from 0 to 9,999,999,999.99 KES |
| GET | `/api/v1/maps/tiles/:z/:x/:y` | No | Proxy and cache an OpenStreetMap raster tile; tile coordinates are validated |
| GET | `/api/v1/maps/places?input=...` | Rider | Search place names and coordinates through the public Photon demo |
| POST | `/api/v1/maps/routes` | Rider | Return up to three OSRM driving-profile route previews ordered by distance |

The one-time `npm run admin:create --workspace @boda-tracker/api` command bootstraps the initial `PLATFORM_ADMIN` after the database migration. The bootstrap is protected by a PostgreSQL advisory lock and refuses to create another platform admin after the first exists.

SACCO provisioning accepts `registrationNumber` as optional. If supplied, it must contain 3–40 valid characters; an omitted or blank value is stored as `null` so it can be added later.

The dashboard's public `/register` page uses the registration endpoint, then signs in the new administrator. The SACCO and administrator are created in one database transaction; duplicate registration details or phone numbers are rejected. Rider accounts created by that administrator belong to the same SACCO and can sign in to the rider app with the credentials issued by the SACCO.

## Planned routes

Password reset and account invitations are not implemented. Access-token lifetime is 15 minutes; refresh tokens expire after 30 days and are stored as SHA-256 hashes. Configure a unique `AUTH_ACCESS_TOKEN_SECRET` of at least 32 characters. Development generates an ephemeral secret when none is configured; production startup fails without one.

Trip starts use an idempotency key and an advisory lock so a retried request returns its original trip instead of creating a duplicate. Fare completion accepts up to two decimal places; repeating completion with the same fare returns the completed trip, while a different fare is rejected. An in-progress trip must be completed before its work session can end. Rider and SACCO scope is derived from the authenticated account; caller-supplied tenant IDs are rejected.

Expenses, location ingestion/history, reports, password recovery, account invitations, and audit-log querying require further implementation.

Maps use public OpenStreetMap tiles, Photon place search, and the OSRM demo router. Their best-effort availability and usage limits make them suitable only for prototyping; no API keys are required. The native map renderer is MapLibre. The tile proxy uses an identifying User-Agent, returns upstream cache headers, and displays OpenStreetMap attribution. Search strings are sent to Photon and route coordinates to OSRM through the API. OSRM uses a car-driving profile, not motorcycle routing; route previews may be incomplete or unsafe and must not be relied on for real rides. Keep map endpoints rate-limited and use a contracted, appropriately licensed service before production.

## OpenAPI

An OpenAPI document has not yet been added. Add it as the authenticated operational routes are implemented.
