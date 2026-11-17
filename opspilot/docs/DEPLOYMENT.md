# Installation and deployment guide

## Verified runtime

Next.js 16 App Router, React 19, TypeScript, Node.js 22, PostgreSQL with Drizzle. The managed production preview is built and health checked with the platform runtime. External LLM, email, storage, payment, Docker, and hosted CI integrations are not asserted to work without their own environment-specific checks.

## Fresh installation

1. Provision a dedicated fresh PostgreSQL database and user; keep it private.
2. Install Node.js 22 and run `npm ci` from the repository root.
3. Copy `.env.example` to `.env`. Set DATABASE_URL. Do not commit credentials.
4. Apply migrations with `npx tsx opspilot/scripts/migrate.ts`.
5. Generate routes, type check, and build: `npx next typegen`, `npm exec tsc -- --noEmit --pretty false`, `npm run build`.
6. Run the application under a process supervisor with `npm run start`.
7. Check `/api/health`, register a workspace, and exercise a create/read/payment workflow in the actual deployment.

For development, use `npm run dev`. `drizzle-kit push` is useful for disposable development databases, but does not populate the migration journal. Do not mix an unbaselined push-provisioned database with the initial CREATE migration.

## Containers

`docker compose up --build` configures a private PostgreSQL service and a non-root application container. The host port is loopback-only. Set POSTGRES_PASSWORD to a strong URL-safe value. Migrations run before the app starts. The Docker build uses a dummy database URL only during compilation; runtime receives the actual database connection through the environment.

Container configuration is supplied but not executed in this sandbox. Validate the image, operating-system package audit, non-root file permissions, migration behavior, health checks, backup mounts, and graceful shutdown before use.

## Before public exposure

This foundation is not approved for sensitive production deployment. Complete the blockers in SECURITY.md and UNFINISHED.md, especially account verification/recovery, ingress trust and abuse protection, upload streaming limits, retention/quotas, RLS/least privilege, monitoring, and restores.

Use HTTPS, set COOKIE_SECURE=true, and configure the reverse proxy to overwrite forwarding headers from untrusted clients. Enforce body-size, connection, timeout, and rate limits at the edge. Never expose PostgreSQL directly. Configure explicit retention of demo workspaces and expired sessions/rate buckets.

## Optional provider

No paid requests occur with AI_ENABLED=false. Enabling AI requires explicit configuration and acceptance of provider costs. Set the server-only API key and an approved HTTPS base URL/model. The implementation uses the Chat Completions structured-output interface, with store=false and a constrained intent enum. No financial figures or workspace records are sent for classification. Validate compatibility and retention policies with your chosen provider. No external provider was called in delivery tests.

## Backups

`bash opspilot/scripts/backup.sh /secure/location/opspilot.dump` uses DATABASE_URL and pg_dump with restrictive local file permissions. Install PostgreSQL client tooling separately. Schedule encrypted off-host copies, protect keys, and regularly verify restoration into an isolated database. Neither a production backup schedule nor disaster-recovery exercise was completed here.

## CI

`.github/workflows/ci.yml` starts a fresh PostgreSQL test service, applies migrations, type-checks/builds, audits production dependencies, and runs unit, API, and browser tests. No deployment or paid external service is configured. Hosted execution has not been observed during this session.
