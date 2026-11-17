# Database design

The initial Prisma schema is `apps/api/prisma/schema.prisma`. It describes the foundation and is not yet backed by an applied production migration.

## Entities and relationships

- **Sacco** owns tenant records and has many users, vehicles, assignments, work sessions, trips, expenses, location updates, and audit logs.
- **User** has a globally unique phone number, password hash, role, account status, and optional SACCO. `PLATFORM_ADMIN` accounts are platform-scoped; `SACCO_ADMIN` and `RIDER` accounts must be assigned a SACCO by authorized provisioning logic.
- **Vehicle** belongs to one SACCO and has a normalized registration identifier unique within that SACCO. Types start with `MOTORCYCLE` and `MATATU`.
- **VehicleAssignment** preserves operator-to-vehicle history and identifies the assigning actor.
- **WorkSession** binds a rider, vehicle, SACCO, and the exact historical vehicle assignment; it records start/end state and optional coordinates.
- **Trip** belongs to a rider, vehicle, and work session in one SACCO; money uses PostgreSQL `DECIMAL`, not floating point.
- **Expense** records a rider's reported category and amount; it is not implicitly verified.
- **LocationUpdate** records capture and server-receive times, accuracy, source, and an idempotency key.
- **AuditLog** attributes an action to a user and optionally a SACCO; metadata must exclude credentials and unnecessary personal data.
- **RefreshToken** stores a token hash, not the bearer token.
- **PasswordResetToken** stores a one-time token hash and expiry.
- **IdempotencyRecord** supports retry-safe operations with request fingerprint and cached response.

## Key constraints and indexes

- Foreign keys use `RESTRICT` for historical operational data; authentication tokens cascade with account deletion.
- Phone numbers are expected to be normalized to E.164 before writes; registration numbers are normalized before tenant-scoped uniqueness checks.
- Composite `(id, saccoId)` keys are referenced by operational relations to prevent cross-tenant associations at the database layer.
- Decimal columns preserve exact fare/expense values.
- Tenant/time/status indexes support dashboards and reports with date filtering.
- Unique idempotency keys are scoped to the actor.
- PostgreSQL partial unique indexes in the initial SQL migration ensure at most one active session per rider, one active assignment per vehicle/rider, and one in-progress trip per rider. Prisma schema syntax does not express these predicates; keep the raw SQL indexes in future migration history and test them against PostgreSQL.

## Ownership and lifecycle invariants

- A work session and its rider, vehicle, SACCO, trips, and optional session-linked expenses/locations must agree on SACCO.
- Only one active work session per rider is permitted initially. Interrupted sessions remain historical until explicitly resumed or resolved by a documented server workflow.
- A trip, and any session-linked expense or location, must reference the same SACCO and the work session's rider/vehicle through compound foreign keys.
- Cancelled trips do not contribute to recorded fare totals. Historical financial corrections should use audited adjustments rather than silent destructive edits.
- These lifecycle rules require service-level checks and transactional writes in addition to database constraints; they are not implemented in Phase 1.

## Relationship sketch

```text
Sacco 1--* User
Sacco 1--* Vehicle 1--* VehicleAssignment *--1 User (rider)
Sacco 1--* WorkSession *--1 User (rider)
WorkSession 1--* Trip *--1 Vehicle
User 1--* Expense
WorkSession 1--* Expense (optional)
User/Vehicle/WorkSession 1--* LocationUpdate (session optional)
User 1--* AuditLog; Sacco 1--* AuditLog (optional)
User 1--* RefreshToken
User 1--* PasswordResetToken
User 1--* IdempotencyRecord
```

## Retention

Location rows are indexed for operational queries but no automatic deletion policy is configured yet. Before location ingestion, establish a purpose-based retention period, retention job, legal hold/access process, deletion procedure, and audit method. Do not retain high-frequency points indefinitely by default.
