import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const candidateStatuses = ["pending", "sent", "enriched"] as const;
export type CandidateStatus = (typeof candidateStatuses)[number];

export const candidates = pgTable("candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  linkedinUrl: text("linkedin_url").notNull().unique(),
  email: text("email"),
  status: text("status", { enum: candidateStatuses })
    .notNull()
    .default("pending"),
  enrichment: jsonb("enrichment"),
  lastDispatchError: text("last_dispatch_error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  enrichedAt: timestamp("enriched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;
