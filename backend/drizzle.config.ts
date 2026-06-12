import { defineConfig } from "drizzle-kit";

try {
	process.loadEnvFile(".env");
} catch {
	// .env not present — drizzle-kit commands that don't need DATABASE_URL still work
}

export default defineConfig({
	schema: "./src/features/*/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "",
	},
	strict: true,
	verbose: true,
});
