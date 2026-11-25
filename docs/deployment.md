# Deployment and operations

## Current status

`render.yaml` defines the API and admin dashboard on Render's free web-service plan in Singapore, using the existing Supabase PostgreSQL database. The configured Supabase endpoint is in AWS `eu-west-1`, so requests between it and Render Singapore cross regions and may have noticeable latency. The Blueprint has not yet been applied. This free-tier setup is for testing, not production: Render free services spin down after inactivity, and Supabase free-project limits, pausing, backups, and availability may affect the database.

The Android app is not deployed by this Blueprint.

## Configuration

- API variables are listed in `apps/api/.env.example`.
- Africa's Talking SMS variables are optional until rider messaging is enabled; Safaricom delivery requires a dedicated, approved Sender ID.
- Set `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and `BREVO_SENDER_NAME` on the API service to deliver email confirmation, sign-in, and rider activation codes. Verify the sender address in Brevo first.
- The API requires Node.js 20.19 or later for Prisma 7 and the current dashboard toolchain.
- Dashboard variables are listed in `apps/dashboard/.env.example`.
- Rider development URL is listed in `apps/rider-app/.env.example`.
- `.node-version` pins the Render build runtime to Node.js 24.22.1.
- Never use example passwords or commit real secrets. Use separate credentials for development, staging, and production.
- Require HTTPS and secure secret injection in every shared environment.

## Free-tier Render setup

1. Connect the private `JESamm/boda-tracker` repository to Render as a Blueprint using the root `render.yaml`. Review the Blueprint preview; it defines two free web services and does not create a database.
2. Set `DATABASE_URL` on the API service to the existing Supabase PostgreSQL connection string using Render's environment settings. Keep the connection string private. Use a Supabase session-pooler or direct connection appropriate for the deployed API.
3. In the API service's Render settings, create a deploy hook. In GitHub repository settings, add these Actions repository secrets:
   - `MIGRATION_DATABASE_URL`: the Supabase session-pooler or direct connection URL for running Prisma migrations.
   - `RENDER_API_DEPLOY_HOOK_URL`: the API service's secret Render deploy hook URL.
4. Run the **Deploy to Render** workflow from the GitHub Actions tab. It applies committed migrations to Supabase first, then triggers the API deployment. API auto-deploy is disabled to prevent deploying code without its migrations; run this workflow for API changes. The dashboard can auto-deploy independently.
5. After the API deploy succeeds, create the initial platform administrator once from a local PowerShell session with this repository checked out. The API's local `.env` must point to the same Supabase database:

   ```powershell
   $env:BOOTSTRAP_ADMIN_NAME = "Platform Administrator"
   $env:BOOTSTRAP_ADMIN_PHONE = "+254712345678"
   $env:BOOTSTRAP_ADMIN_EMAIL = "admin@example.com"
   $env:BOOTSTRAP_ADMIN_PASSWORD = Read-Host "One-time administrator password"
   npm run admin:create --workspace @boda-tracker/api
   Remove-Item Env:BOOTSTRAP_ADMIN_NAME, Env:BOOTSTRAP_ADMIN_PHONE, Env:BOOTSTRAP_ADMIN_EMAIL, Env:BOOTSTRAP_ADMIN_PASSWORD
   ```

   Replace the example phone number and email and use a unique password. Bootstrap is intentionally one-time and marks the operator-supplied email verified. Render's free web services do not provide Shell access, so run this command locally; never commit the credentials.

   If the intended database already contains the specific emulator test administrator, do not rerun bootstrap. After confirming `apps/api/.env` points to the same intended database, run `npm run admin:replace-test --workspace @boda-tracker/api` from an interactive local terminal. The command only replaces that exact test record, prompts for the new name, phone, and email with the password hidden, marks the operator-supplied email verified, and revokes its refresh sessions.
6. Verify the API at `/health/live` and `/api/v1/health/ready`, then open the dashboard service URL and sign in at `/login`.
7. Configure a production Android build with the deployed API base URL before distributing the rider app. Do not reuse the development URL in `apps/rider-app/.env.example`.

SACCO administrators can register directly from the dashboard's **Create your SACCO workspace** link on `/login` (or at `/register`). The workspace and administrator are created immediately, but the administrator must confirm their email before email sign-in; each email sign-in sends a fresh code. Existing users without email can continue signing in by phone and add/confirm an email in dashboard **Settings** or the rider app **Account** tab. From the portal, add riders using their names, phone numbers, and email addresses; no temporary password is created or sent. Riders receive an email activation code, choose a password in the app, and verify a fresh code on every email sign-in. Phone sign-in remains supported, with SMS codes for rider phone sign-in and password changes.

### Transactional email setup

Create a Brevo API key and verify the sender address in Brevo. Add `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and `BREVO_SENDER_NAME` to the Render API service's **Environment** settings. Keep the key private and never place it in dashboard/mobile configuration or source control. Email confirmation and activation are not available until these values are configured; if a send fails after an account is created, the user can request a fresh code after email delivery is restored.

### Rider SMS setup

Set these variables in the Render API service's **Environment** settings; do not commit credentials:

- `AFRICAS_TALKING_USERNAME`
- `AFRICAS_TALKING_API_KEY`
- `AFRICAS_TALKING_SENDER_ID`

The default Africa's Talking Sender ID is for Airtel testing only. To deliver to Safaricom, apply for a dedicated Sender ID in the Africa's Talking dashboard and configure the approved value. Confirm account balance and message pricing with the provider; the testing API does not imply free production SMS. If SMS is not configured or delivery fails, the rider remains `INVITED`, the API reports the failure, and the rider can request another activation code after configuration. Do not send real SMS from automated tests.

The dashboard's `NEXT_PUBLIC_API_BASE_URL` must point to the deployed API base path (`/api/v1`) so the browser can register directly with the API; the Render Blueprint derives it from the API service URL. The API CORS origin must match the dashboard URL.

The API trusts Render's single inbound proxy hop so IP-based rate limits use the client address from `X-Forwarded-For`; do not expose the API directly behind additional untrusted proxy hops.

## Database setup and migration operations

The current deployment uses the Supabase PostgreSQL project already configured for development. Verify its region, free-tier limits, connection limits, TLS, backups, restore options, and data retention before using real rider data.

`DATABASE_URL` is used by the running API. If it points to a transaction pooler, set `MIGRATION_DATABASE_URL` in `apps/api/.env` to a direct or session-pooler connection for Prisma migration commands; the Prisma config falls back to `DATABASE_URL` when it is unset.

```powershell
npm run db:validate
npm run db:generate
npm run db:migrate
```

Use `npm run db:deploy` for applying committed migrations in a deployment pipeline; do not use development migration commands against production. The GitHub Actions deployment workflow runs migrations with `MIGRATION_DATABASE_URL` before triggering the Render API deploy hook.

## Operational readiness checklist

- Provision separate least-privilege database users and rotate credentials.
- Configure automated encrypted backups and test restoration before pilot.
- Add request logging with redaction, health monitoring, alerting, and incident response.
- Configure rate limiting with a shared store for multi-instance deployments.
- Apply schema migrations through a controlled release step.
- Confirm data residency, location retention/deletion, and privacy/legal obligations.
- Re-check live provider limits/pricing and Expo Android build requirements before launch.
- Verify database backup and restore, monitoring/alerts, and incident-response procedures before using real rider data.
