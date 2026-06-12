import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../lib/env.js";
import * as schema from "./schema.js";

export const ownerPool = new pg.Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle(ownerPool, { schema });
export type Db = typeof db;
