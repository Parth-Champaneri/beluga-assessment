import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { env } from "../lib/env.js";
import * as schema from "./schema.js";

export const ownerPool = new Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle(ownerPool, { schema });
export type Db = typeof db;
