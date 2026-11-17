# Architecture

## Components

- **Rider application (`apps/rider-app`)**: React Native/Expo Android client. It will capture operator actions and consented location updates, retain permitted work offline, and synchronize through the versioned API.
- **Administrative dashboard (`apps/dashboard`)**: Next.js and TypeScript web client for SACCO and platform administration. The initial screen is a truthful setup state, not a mock dashboard.
- **API (`apps/api`)**: TypeScript/Express REST service. It will authenticate users, derive tenant scope from verified identity, validate requests, apply business rules, persist transactions, and record audit events.
- **PostgreSQL**: authoritative source of truth, accessed through Prisma 7 and the PostgreSQL driver adapter. Tenant ownership appears directly on operational rows and compound foreign keys bind members, vehicles, sessions, trips, expenses, and locations to a common SACCO.
- **Real-time distribution (planned)**: Socket.IO may publish already-persisted events to authenticated SACCO-scoped rooms. Reconnecting clients must reload state from the API.

## Data flow

1. A provisioned client authenticates with the API.
2. The API validates the account and grants an identity/role context; clients never prove tenant access by sending a `saccoId`.
3. A request is validated and scoped to that identity on the server.
4. Business changes are written transactionally to PostgreSQL; sensitive changes also create audit events.
5. Only after persistence may the API publish a real-time event.
6. Clients recover state by querying persisted API records. Mobile offline actions use idempotency keys and server validation on synchronization.

## Tenant boundaries

Platform administrators operate at platform scope. SACCO administrators are scoped to their authenticated SACCO. Riders are scoped to their own user records and valid assigned operations. Queries must filter by derived identity scope, not client-provided IDs. Compound database relations provide an additional guard against connecting a SACCO A rider to a SACCO B vehicle or session. Application authorization remains required.

## Phase 1 decisions

- npm workspaces keep API, dashboard, and rider client in one repository without coupling their release artifacts.
- The mobile client uses React Native with Expo development builds. Expo Go is not the deployment target because native/background capabilities require a custom Android build.
- Prisma 7 with `@prisma/adapter-pg` uses the maintained PostgreSQL driver adapter and generated TypeScript client.
- Location collection, authentication, and operational API endpoints are deliberately absent at this stage.
- The prior root-level Vite and JSON API prototype is retained for inspection but excluded from workspace scripts. It contains fabricated seed records and is not production software.

## Planned real-time boundary

The database transaction must commit before a Socket.IO event is emitted. Socket connections will authenticate against the same session system as REST, and room membership will be determined from server-side authorization. Clients must refetch on reconnect; transient events are not records.
