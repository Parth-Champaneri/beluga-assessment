CREATE TABLE "job_descriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"description_text" text NOT NULL,
	"profile" jsonb,
	"profile_extraction_meta" jsonb,
	"profile_embedding" vector(3072),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
