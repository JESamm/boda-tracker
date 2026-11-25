# Boda-Tracker

Boda-Tracker is a multi-tenant transport operations platform for boda boda riders, matatu operators, and their SACCOs in Kenya. The repository is an npm-workspaces monorepo.

## Current status

The initial foundation now includes the first usable identity and organisation workflows:

- A versioned TypeScript/Express API with liveness and PostgreSQL readiness endpoints.
- A PostgreSQL Prisma 7 schema with SACCO-scoped relationships, operational records, audit records, and session-token storage.
- A Next.js/TypeScript administration portal with self-service SACCO workspace registration, SACCO-scoped rider and fleet management, and vehicle assignments. Reports and settings remain explicit empty states until their APIs are implemented.
- A React Native Android app scaffolded with Expo and TypeScript.
- API health endpoint tests and architecture/security/privacy documentation.

API login, email confirmation and email-code sign-in, phone sign-in, rider activation and password setup, verified rider password changes, refresh-token rotation/revocation, account status checks, one-time platform-admin bootstrap, public SACCO workspace registration, platform-admin SACCO provisioning, SACCO-scoped rider and vehicle creation/listing, vehicle assignments, work sessions, rider trip/fare recording, and rider-only map search and route-preview endpoints are implemented. Email is the preferred login; new accounts require a unique email, confirm it after registration, and receive a fresh code on every email/password sign-in. Existing accounts without an email can continue using phone login and add/verify one from Settings or the rider app's Account tab. Phone sign-in remains available; rider phone sign-ins and password changes use SMS. Configure Brevo transactional email for verification and Africa's Talking SMS for rider phone workflows. SACCO administrators register at `/register` and must verify their email before email sign-in. SACCO admins invite riders by email; riders activate with the email code and choose their own password. Live SMS requires Africa's Talking credentials and an approved Sender ID; the default Sender ID is limited to Airtel testing, and Safaricom delivery requires a dedicated Sender ID. Expenses, reports, route-history persistence, offline synchronization, and forgotten-password recovery are **not implemented yet**. Map previews use public OpenStreetMap tiles, Photon place search, and the OSRM demo router with a car-driving profile; they are best-effort prototype services, not motorcycle navigation, and must not be used to guide real rides. See the map setup below. Other operational pages are explicit empty states and do not contain fabricated records. The original root Vite UI is retained for reference, and its JSON-backed API is archived at `legacy/prototype-server.js`; neither is used by workspace scripts or suitable for production.

### Maps setup

No map API keys are needed for the emulator prototype. The native map renderer is MapLibre; map tiles come from OpenStreetMap, place search from the public Photon demo, and route previews from the public OSRM demo router. These shared public services may throttle or change availability and are not a production service commitment. Requests leave the app/API and are handled under those providers' policies; the app does not persist location history. OSRM uses a car-driving profile, not a motorcycle profile, and its results may be unsuitable or unsafe for riders. The map clearly warns against relying on its routes for real rides and displays OpenStreetMap attribution.

## Architecture

```text
apps/
  api/         Express + TypeScript + Prisma + PostgreSQL
  dashboard/   Next.js + React + TypeScript
  rider-app/  React Native + Expo + TypeScript (Android first)
docs/          Architecture, data model, API, security, privacy, deployment
```

PostgreSQL is the authoritative store. The API owns authentication, tenant scope, business rules, database writes, and audit events. The dashboard and mobile app are API clients; the mobile app will additionally use encrypted token storage and a local queue for explicitly supported offline actions.

## Prerequisites

- Node.js 20.19 or later (Prisma 7 minimum; also satisfies Next.js).
- npm 10 or later.
- PostgreSQL 14 or later, locally or managed.
- Android Studio and Android SDK for a local Android build.
- Expo tooling through the project scripts; no global Expo installation is required.

Docker is optional. If using Docker, start Docker Desktop before using the local database instructions. The current workstation did not have a running Docker engine; Flutter is not required because the rider client uses React Native.

## Local setup

1. Install workspace dependencies:

   ```powershell
   npm install
   ```

2. Create a local PostgreSQL database and role. The following is an example for a local-only database; do not reuse these values in a deployed environment:

   ```sql
   CREATE USER boda_tracker WITH PASSWORD 'local_dev_only';
   CREATE DATABASE boda_tracker OWNER boda_tracker;
   ```

3. Copy `apps/api/.env.example` to `apps/api/.env` and set `DATABASE_URL` to your PostgreSQL connection string. If the provider uses a transaction pooler, set `MIGRATION_DATABASE_URL` to its direct or session-pooler connection for Prisma migrations. Copy `apps/dashboard/.env.example` to `apps/dashboard/.env.local` and `apps/rider-app/.env.example` to `apps/rider-app/.env` when those clients need local API URLs. Example values are for local development only.

4. Validate and generate the Prisma client, then apply migrations:

   ```powershell
   npm run db:validate
   npm run db:generate
   npm run db:migrate
   ```

5. Configure a unique `AUTH_ACCESS_TOKEN_SECRET` (at least 32 characters) in `apps/api/.env`. Create the first platform administrator exactly once from a PowerShell session. Keep the bootstrap password out of source control and clear the environment variable after use:

   ```powershell
   $env:BOOTSTRAP_ADMIN_NAME = "Platform Administrator"
   $env:BOOTSTRAP_ADMIN_PHONE = "+254712345678"
   $env:BOOTSTRAP_ADMIN_EMAIL = "admin@example.com"
   $env:BOOTSTRAP_ADMIN_PASSWORD = Read-Host "One-time administrator password"
   npm run admin:create --workspace @boda-tracker/api
   Remove-Item Env:BOOTSTRAP_ADMIN_NAME, Env:BOOTSTRAP_ADMIN_PHONE, Env:BOOTSTRAP_ADMIN_EMAIL, Env:BOOTSTRAP_ADMIN_PASSWORD
   ```

   Bootstrap refuses to run once a platform administrator exists. It treats the operator-supplied email as verified. Do not reuse the example phone number or email.

   If the configured database already contains the specific emulator test administrator, replace it with your intended administrator using the guarded local command:

   ```powershell
   npm run admin:replace-test --workspace @boda-tracker/api
   ```

   Run it only after confirming `apps/api/.env` points to the intended database. It prompts for the new name, phone, and email and reads the password without echoing it. It refuses to modify any account other than the expected test administrator and revokes that account's refresh sessions.

6. Run API and dashboard:

   ```powershell
   npm run dev
   ```

   API liveness: `http://localhost:3001/health/live`

   API readiness: `http://localhost:3001/api/v1/health/ready`

   Dashboard: `http://localhost:3000`

7. Run the Android app from an Android emulator or physical development device:

   ```powershell
   npm run dev:rider
   ```

   The default rider API URL is `http://127.0.0.1:3001/api/v1`. Before using the Android emulator or a USB-connected device, forward the API port from the development computer:

   ```powershell
   adb reverse tcp:3001 tcp:3001
   ```

   For a device connected over Wi-Fi, set `EXPO_PUBLIC_API_BASE_URL` to the development computer's reachable LAN address instead. Do not use an HTTP API endpoint in production; configure HTTPS.

## Validation commands

```powershell
npm run typecheck
npm test
npm run build
npm run db:validate
npm run bundle:rider-android
```

`bundle:rider-android` exports the React Native JavaScript bundle; it does not produce a signed APK/AAB. An actual database connection is required for `db:migrate` and the API readiness endpoint. The API liveness endpoint does not require PostgreSQL.

## Android preview APK

The rider app includes phone/password sign-in against the API, encrypted on-device session storage, assigned-vehicle work sessions, trip/fare recording, and prototype map search and route previews. Generated APKs and local Android signing keys are not committed. To build and install a local preview with current native map changes, run `npm run android --workspace @boda-tracker/rider-app`; debug-signed builds are not suitable for Play Store or production distribution. Expenses and offline synchronization are not implemented yet. On an Android emulator or USB-connected phone, forward the local API port before signing in:

```powershell
adb reverse tcp:3001 tcp:3001
```

## Database and seed data

The initial schema is in `apps/api/prisma/schema.prisma`. No sample production records are seeded. Development fixtures, if added later, must use an explicit seed command and clearly synthetic identities.

## Security and privacy

See [docs/security.md](./docs/security.md), [docs/privacy.md](./docs/privacy.md), and [docs/deployment.md](./docs/deployment.md). Authentication and initial SACCO-scoped administration are implemented, but the platform is not production-ready. Do not expose it publicly or enter real personal/location data until operational authorization, retention controls, TLS, and deployment safeguards have been completed and reviewed.

## Deployment

The Render Blueprint is prepared for free API and admin services using the existing Supabase database, but has not been applied. This is a testing setup, not production hosting; free services can sleep and the database provider's free-tier limits apply. See [docs/deployment.md](./docs/deployment.md) for setup and deployment steps.
