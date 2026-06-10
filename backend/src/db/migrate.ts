import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { db, ownerPool } from "./index.js";

async function main() {
  console.log("[migrate] applying migrations from ./drizzle ...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] done.");
  await ownerPool.end();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
