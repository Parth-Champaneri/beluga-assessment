import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CLAY_WEBHOOK_URL: z.string().url().optional(),
  CLAY_WEBHOOK_AUTH: z.string().min(1).optional(),
  CLAY_CALLBACK_SECRET: z.string().min(1).default("dev-secret"),
  CLAY_MOCK_MODE: z.string().optional(),
  ENRICH_DISPATCH_TIMEOUT_MS: z.coerce.number().default(30000),
  ENRICH_MAX_ATTEMPTS: z.coerce.number().default(5),
  ENRICH_WORKER_INTERVAL_MS: z.coerce.number().default(3000),
  ENRICH_CALLBACK_TIMEOUT_SECONDS: z.coerce.number().default(900),
  ENRICH_DISPATCH_CONCURRENCY: z.coerce.number().int().positive().default(20),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_EXTRACTION_MODEL: z.string().min(1).default("gpt-5.4-2026-03-05"),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-large"),
  OPENAI_TIMEOUT_MS: z.coerce.number().default(30000),
  PROFILE_WORKER_INTERVAL_MS: z.coerce.number().default(5000),
  PROFILE_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(20),
  PROFILE_MAX_ATTEMPTS: z.coerce.number().default(5),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
