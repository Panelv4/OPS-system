import pkg from "../../../package.json";

/** Version reported by `/api/health/ready`. Keep in sync with package.json. */
export const APP_VERSION: string = pkg.version;

/**
 * Number of migrations that must be applied for this build to be considered
 * ready. Bump it when adding a migration; `migrations.test.ts` asserts that it
 * matches the number of `.sql` files, so the two cannot drift silently.
 */
export const EXPECTED_MIGRATIONS = 5;
