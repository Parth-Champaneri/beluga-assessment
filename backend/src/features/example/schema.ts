import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const example = pgTable("example", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Example = typeof example.$inferSelect;
export type NewExample = typeof example.$inferInsert;
