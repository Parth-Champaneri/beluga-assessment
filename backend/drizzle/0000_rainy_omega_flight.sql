CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"linkedin_url" text NOT NULL,
	"email" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"enrichment" jsonb,
	"sent_at" timestamp with time zone,
	"enriched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidates_linkedin_url_unique" UNIQUE("linkedin_url")
);
