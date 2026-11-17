# Product requirements and MVP scope

## Roles

- `PLATFORM_ADMIN`: platform-level SACCO onboarding and oversight.
- `SACCO_ADMIN`: operations administration within one SACCO.
- `RIDER`: own profile and permitted operational records only.

## MVP order

1. Foundation: data model, migrations, validation/error conventions, health monitoring, tests, and deployment documentation.
2. Identity and tenant management: secure authentication, SACCO onboarding, provisioning, rider/vehicle registration, assignment history, and isolation tests.
3. Daily operations: sessions, trips, reported fares/expenses, idempotency, rider history, summaries, and transaction tests.
4. Dashboard: authenticated SACCO views and real API integration.
5. Rider app: React Native Android sign-in, quick session/trip actions, history, offline queue, and synchronization.
6. Location: transparent permission flow, session-bound updates, retention, freshness-aware map, and authorization tests.
7. Pilot hardening: security review, privacy review, Android low-connectivity testing, backup restore, and operational runbooks.

## Client choice

React Native with Expo is selected instead of Flutter to share TypeScript conventions with the API and dashboard. Expo's native modules are suitable for the MVP, but Android background tracking must be verified in a custom development/production build; Expo Go is not sufficient for that capability. Permissions must remain explicit and visible.

## Not in the current foundation

Authentication, SACCO/rider provisioning, vehicle assignment workflows, sessions, trips, financial entry, GPS, offline sync, reports, and notifications are not complete. The initial client shells contain no real or sample operational data.

## Assumptions to validate with a pilot SACCO

- Phone numbers are unique platform-wide and are normalized to E.164.
- Each rider has one current vehicle assignment and one active work session at a time. Matatu crew/route/fare arrangements will require an explicit extension before launch to a matatu operator.
- Rider fares and expenses are reported values until an explicit reconciliation workflow exists.
- Routine GPS transmission is limited to an active, rider-visible work session.
