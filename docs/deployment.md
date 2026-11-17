# Deployment and operations

## Current status

`render.yaml` defines a Render deployment for the API, admin dashboard, and managed PostgreSQL in Singapore. It has not been connected to a repository or deployed. Review Render's current prices before applying the Blueprint: the API and dashboard use paid `0.5c-512mb` plans, and PostgreSQL uses a paid `0.5c-1g` plan so database migrations can run before deploys and data is not on an expiring free database.

The Git repository currently has no commits or remote. Render deployment requires connecting a private GitHub repository containing this project. The Android app is not deployed by this Blueprint.

## Configuration

- API variables are listed in `apps/api/.env.example`.
- The API requires Node.js 20.19 or later for Prisma 7 and the current dashboard toolchain.
- Dashboard variables are listed in `apps/dashboard/.env.example`.
- Rider development URL is listed in `apps/rider-app/.env.example`.
- `.node-version` pins the Render build runtime to Node.js 24.22.1.
- Never use example passwords or commit real secrets. Use separate credentials for development, staging, and production.
- Require HTTPS and secure secret injection in every shared environment.

## Render setup

1. Review Render's current compute and PostgreSQL pricing, backup options, and Singapore region availability before creating resources. Applying the Blueprint creates billable services and a database.
2. Create a private GitHub repository and push this project without any `.env` files or real credentials. Connect the repository to Render as a Blueprint using the root `render.yaml`.
3. Check the Blueprint preview. It creates the API, admin dashboard, and PostgreSQL; Render generates `AUTH_ACCESS_TOKEN_SECRET`, wires the API/database URLs, and applies committed migrations before each API deploy.
4. After the first successful deploy, provision the platform administrator once using the API service's Shell:

   ```sh
   npm run admin:create --workspace @boda-tracker/api
   ```

   Before running it, add `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PHONE`, and a unique `BOOTSTRAP_ADMIN_PASSWORD` to the API service environment. Remove those three variables immediately after the command succeeds. Bootstrap is intentionally one-time.
5. Verify the API at `/health/live` and `/api/v1/health/ready`, then open the dashboard service URL and sign in at `/login`.
6. Configure a production Android build with the deployed API base URL before distributing the rider app. Do not reuse the development URL in `apps/rider-app/.env.example`.

## Database setup and migration operations

Use a managed PostgreSQL service or a maintained self-hosted PostgreSQL deployment. Verify current region availability, pricing, persistent-storage guarantees, connection limits, TLS, backup/restore, and provider terms before choosing a host.

`DATABASE_URL` is used by the running API. If it points to a transaction pooler, set `MIGRATION_DATABASE_URL` in `apps/api/.env` to a direct or session-pooler connection for Prisma migration commands; the Prisma config falls back to `DATABASE_URL` when it is unset.

```powershell
npm run db:validate
npm run db:generate
npm run db:migrate
```

Use `npm run db:deploy` for applying committed migrations in a deployment pipeline; do not use development migration commands against production. Render runs this command as the API service's pre-deploy step.

## Operational readiness checklist

- Provision separate least-privilege database users and rotate credentials.
- Configure automated encrypted backups and test restoration before pilot.
- Add request logging with redaction, health monitoring, alerting, and incident response.
- Configure rate limiting with a shared store for multi-instance deployments.
- Apply schema migrations through a controlled release step.
- Confirm data residency, location retention/deletion, and privacy/legal obligations.
- Re-check live provider limits/pricing and Expo Android build requirements before launch.
- Verify database backup and restore, monitoring/alerts, and incident-response procedures before using real rider data.
