import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../../src/db";
async function main() {
  try { await migrate(db, { migrationsFolder: "opspilot/migrations" }); console.log("OpsPilot migrations applied successfully."); }
  finally { await pool.end(); }
}
main().catch(error => { console.error("Migration failed:", error instanceof Error ? error.message : "Unknown error"); process.exitCode = 1; });
