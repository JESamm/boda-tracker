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
| POST | `/api/v1/auth/login` | No | Verify email/password or phone/password; email sign-in and rider phone sign-in require a code |
| POST | `/api/v1/auth/login/email/verify` | No | Verify the six-digit email sign-in code and issue access/refresh tokens |
| POST | `/api/v1/auth/login/verify` | No | Verify a rider's six-digit SMS sign-in code and issue access/refresh tokens |
| POST | `/api/v1/auth/email/verification/request` | No | Send or resend the confirmation code to an unverified account |
| POST | `/api/v1/auth/email/add` | Access token | Add an email to a legacy account that has none and send a confirmation code |
| POST | `/api/v1/auth/email/verify` | No | Verify a new account's email address |
| POST | `/api/v1/auth/activation/email/complete` | No | Verify an invited rider's email code and let the rider set a password |
| POST | `/api/v1/auth/activation/request` | No | Send or resend an activation SMS to an invited rider account |
| POST | `/api/v1/auth/activation/complete` | No | Verify an activation SMS and let the rider set a password |
| POST | `/api/v1/auth/password/change/request` | Rider access token | Send a verification code before password change |
| POST | `/api/v1/auth/password/change/complete` | Rider access token | Verify the code, change the password, and revoke refresh sessions |
| POST | `/api/v1/auth/refresh` | Refresh token | Atomically rotate the refresh token and issue a new access token |
| POST | `/api/v1/auth/logout` | Refresh token | Revoke the submitted refresh token |
| GET | `/api/v1/auth/me` | Access token | Return the current active account; account and SACCO status are checked on every request |
| POST | `/api/v1/saccos/register` | No | Create an active SACCO workspace and its first SACCO administrator atomically; limited to five registrations per client IP per hour |
| GET | `/api/v1/saccos` | Platform admin | Return a bounded list of SACCOs with their initial administrator |
| POST | `/api/v1/saccos` | Platform admin | Create a SACCO and its initial administrator in one transaction |
| GET | `/api/v1/riders` | SACCO admin | Return a bounded, cursor-paginated list from the authenticated SACCO only |
| POST | `/api/v1/riders` | SACCO admin | Create an invited rider in the authenticated SACCO and send an activation code |
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

Email is the preferred sign-in method. New SACCO administrators and riders require unique emails; the email is confirmed before email sign-in, and every email/password sign-in requires a fresh code. The dashboard's public `/register` page creates the SACCO and administrator in one transaction, then asks the administrator to confirm their email before signing in. Platform-admin provisioning follows the same email confirmation flow. SACCO admins create invited riders with a name, phone, and email; riders receive an activation email and set their own password in the app. Existing accounts without an email can continue using phone sign-in and add an email from their authenticated Settings/Account page, then confirm it. Phone sign-in remains supported: rider phone sign-ins require an SMS code, while admin phone sign-in is retained for compatibility. Rider password changes also require an SMS code and revoke refresh sessions. Passwords are never sent by email or SMS.

Email and SMS verification codes expire after 10 minutes, are HMAC-hashed at rest, allow at most five guesses, and are limited to one send per minute and five sends per hour per account. Configure `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and `BREVO_SENDER_NAME` in the API environment; the sender address must be verified in Brevo. Until Brevo is configured, account creation may succeed while email delivery reports failure; users can request a new code after delivery is configured. Configure `AFRICAS_TALKING_USERNAME`, `AFRICAS_TALKING_API_KEY`, and `AFRICAS_TALKING_SENDER_ID` for rider phone sign-in and password changes. The default Africa's Talking Sender ID is limited to Airtel testing; Safaricom delivery requires an approved dedicated Sender ID.

Access-token lifetime is 15 minutes; refresh tokens expire after 30 days and are stored as SHA-256 hashes. Configure a unique `AUTH_ACCESS_TOKEN_SECRET` of at least 32 characters. Development generates an ephemeral secret when none is configured; production startup fails without one.

Trip starts use an idempotency key and an advisory lock so a retried request returns its original trip instead of creating a duplicate. Fare completion accepts up to two decimal places; repeating completion with the same fare returns the completed trip, while a different fare is rejected. An in-progress trip must be completed before its work session can end. Rider and SACCO scope is derived from the authenticated account; caller-supplied tenant IDs are rejected.

Expenses, location ingestion/history, reports, forgotten-password recovery, and audit-log querying require further implementation. Rider activation and authenticated password changes are implemented; forgotten-password recovery is not.

Maps use public OpenStreetMap tiles, Photon place search, and the OSRM demo router. Their best-effort availability and usage limits make them suitable only for prototyping; no API keys are required. The native map renderer is MapLibre. The tile proxy uses an identifying User-Agent, returns upstream cache headers, and displays OpenStreetMap attribution. Search strings are sent to Photon and route coordinates to OSRM through the API. OSRM uses a car-driving profile, not motorcycle routing; route previews may be incomplete or unsafe and must not be relied on for real rides. Keep map endpoints rate-limited and use a contracted, appropriately licensed service before production.

## OpenAPI

An OpenAPI document has not yet been added. Add it as the authenticated operational routes are implemented.
