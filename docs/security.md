# Security status

## Implemented authentication baseline

- Versioned API path for readiness.
- Helmet security headers, explicit CORS origin list, 64 KiB JSON request limit, and an authentication-path rate limiter.
- Production-safe readiness error response that does not include database exception details.
- Passwords use Node.js `scrypt` with a random 128-bit salt and fixed, versioned parameters.
- Email is the preferred login; new account emails are unique and must be confirmed. Every email/password login requires a one-time email code. Phone-number login remains available for existing users and returns a generic credential failure for unknown accounts and incorrect passwords.
- Rider password sign-in requires a one-time SMS code before tokens are issued; activation codes let invited riders set their own passwords without sending passwords by SMS.
- Verification codes are HMAC-hashed, expire after 10 minutes, allow five guesses, and have per-account and per-IP send limits.
- Brevo transactional email sends confirmation, sign-in, and rider activation codes; keep its API key in private API-service configuration and verify the sender address.
- Rider password changes require a phone verification code and revoke refresh sessions.
- Access tokens are HS256-signed and expire after 15 minutes. Protected requests re-check the user's account and SACCO status.
- Refresh tokens are random opaque values. Only SHA-256 hashes are stored; refresh uses atomic one-time rotation and reuse revokes active sessions.
- A one-time platform-admin bootstrap command uses a PostgreSQL advisory lock and refuses to create a second platform admin.
- Production API startup requires a unique `AUTH_ACCESS_TOKEN_SECRET` of at least 32 characters.
- `.env` files are ignored, and example environment files contain local placeholders only.
- SACCO ownership is encoded in compound operational relations in addition to planned application authorization.

## Remaining security work

- Forgotten-password recovery remains unimplemented.
- Database-backed cross-SACCO tests, socket authentication, production TLS/secrets, monitoring, backups, and incident response remain outstanding.

## Required implementation rules

- Do not accept `saccoId` as authorization evidence. Obtain scope from a verified user and check requested records against it.
- Apply role, SACCO, rider ownership, account status, vehicle assignment, and session-state checks in the service layer.
- Keep password-hash parameters versioned; store refresh/reset token hashes; rotate and revoke refresh tokens; do not return authentication internals.
- Browser sign-in stores API tokens in HTTP-only, SameSite cookies, uses same-origin checks for session-changing routes, and proxies tokens server-side. Production cookies use the Secure attribute. Keep mobile credentials in platform secure storage.
- SACCO provisioning is restricted to platform admins. Rider and vehicle list/create routes require SACCO-admin role and derive tenant IDs from the authenticated account; tests reject caller-supplied tenant IDs.
- SACCO, rider, and vehicle creates write audit records without credentials or unnecessary personal data.
- Configure and monitor Africa's Talking credentials and approved Sender ID outside source control; the default Sender ID does not cover Safaricom.
- Configure and monitor Brevo credentials outside source control; do not log or expose verification codes or provider secrets.
- Continue adding database-backed cross-SACCO integration tests for authorization-sensitive routes.
- Run `npm audit` and dependency update review before each release.

## Dependency audit note

At initial setup, npm reported five high advisories in the latest Expo SDK 58 CLI dependency chain (`node-forge` and its nested Zod 3 dependency). npm's proposed automatic fix downgrades Expo to SDK 54, so it was not applied because that would move the project to an older SDK major. This CLI toolchain finding must be reviewed against Expo's patched releases before using SDK tooling with untrusted projects or preparing a production build. Prisma 7 and Vitest 5 remove the initial Prisma CLI and test-runner advisories. The API's runtime-only dependency audit currently reports no vulnerabilities; the full monorepo audit remains non-clean because of Expo. Do not treat the project as security-cleared until the remaining findings are resolved or explicitly accepted.
