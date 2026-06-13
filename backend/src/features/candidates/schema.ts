import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  vector,
} from "drizzle-orm/pg-core";

export const candidates = pgTable("candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  linkedinUrl: text("linkedin_url").notNull().unique(),
  email: text("email"),
  enrichment: jsonb("enrichment"),
  profile: jsonb("profile"),
  profileExtractionMeta: jsonb("profile_extraction_meta"),
  profileEmbedding: vector("profile_embedding", { dimensions: 3072 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;

export const enrichmentJobStatuses = [
  "queued",
  "dispatched",
  "done",
  "failed",
] as const;
export type EnrichmentJobStatus = (typeof enrichmentJobStatuses)[number];

export const enrichmentJobs = pgTable(
  "enrichment_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .unique()
      .references(() => candidates.id, { onDelete: "cascade" }),
    status: text("status", { enum: enrichmentJobStatuses })
      .notNull()
      .default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusNextAttemptIdx: index("enrichment_jobs_status_next_attempt_at_idx").on(
      t.status,
      t.nextAttemptAt,
    ),
  }),
);

export type EnrichmentJob = typeof enrichmentJobs.$inferSelect;
export type NewEnrichmentJob = typeof enrichmentJobs.$inferInsert;

export const profileJobStatuses = [
  "queued",
  "dispatched",
  "done",
  "failed",
] as const;
export type ProfileJobStatus = (typeof profileJobStatuses)[number];

export const profileJobs = pgTable(
  "profile_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .unique()
      .references(() => candidates.id, { onDelete: "cascade" }),
    status: text("status", { enum: profileJobStatuses })
      .notNull()
      .default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusNextAttemptIdx: index("profile_jobs_status_next_attempt_at_idx").on(
      t.status,
      t.nextAttemptAt,
    ),
  }),
);

export type ProfileJob = typeof profileJobs.$inferSelect;
export type NewProfileJob = typeof profileJobs.$inferInsert;
