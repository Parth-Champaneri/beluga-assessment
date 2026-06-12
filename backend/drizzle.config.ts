import { defineConfig } from "drizzle-kit";

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
