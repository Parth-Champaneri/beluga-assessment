import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const SENIORITY_BANDS = [
  "junior",
  "mid",
  "senior",
  "staff_plus",
  "leadership",
  "unknown",
] as const;

export const STACK_ORIENTATIONS = [
  "frontend",
  "backend",
  "fullstack",
  "infra",
  "data",
  "ml",
  "mobile",
  "other",
  "unknown",
] as const;

export const COMPANY_STAGES = ["startup", "scaleup", "enterprise"] as const;

export const B2B_B2C = ["b2b", "b2c", "both", "unknown"] as const;

export const TENURE_PATTERNS = [
  "job_hopper",
  "normal",
  "long_tenured",
  "unknown",
] as const;

export const ARCHETYPES = [
  "generalist",
  "specialist",
  "hybrid",
  "unknown",
] as const;

export const TRACKS = ["ic", "manager", "mixed", "unknown"] as const;

/**
 * The persisted profile — facets only. extraction_meta lives in its own
 * jsonb column on `candidates` so it doesn't pollute the embedding-input
 * builder, the UI render, or downstream filtering. Same shape is sent to
 * OpenAI's structured outputs (every property required +
 * additionalProperties:false) so strict mode is happy.
 */
export const profileSchema = z.object({
  seniority_band: z.enum(SENIORITY_BANDS),
  stack_orientation: z.enum(STACK_ORIENTATIONS),
  company_stage_exposure: z.array(z.enum(COMPANY_STAGES)).max(3),
  b2b_b2c: z.enum(B2B_B2C),
  tenure_pattern: z.enum(TENURE_PATTERNS),
  industries: z.array(z.string()).max(4),
  years_experience: z.number().int().min(0).max(80).nullable(),
  archetype: z.enum(ARCHETYPES),
  track: z.enum(TRACKS),
  key_skills: z.array(z.string()).max(10),
  summary: z.string().min(1).max(800),
  /**
   * The candidate's most recent / current job title, lowercased, lightly
   * normalized (drop suffixes like "II", "Sr.", trim "@ company"). Used
   * to scope the responsibilities list below and to make the embedding
   * carry the role identity, not just the seniority band.
   */
  recent_role_title: z.string().max(120),
  /**
   * Responsibilities, duties, projects, and achievements aggregated from
   * EVERY role in the candidate's history whose title matches or is
   * closely related to recent_role_title — e.g. for "software engineer"
   * pull from prior "senior software engineer", "backend engineer",
   * "software developer" roles. Exclude unrelated roles (designer,
   * marketing, founder unless that founder role was the same craft).
   * Each entry is one short bullet (one sentence is ideal).
   */
  recent_role_responsibilities: z.array(z.string().max(400)).max(30),
});

/**
 * Audit/debug metadata captured server-side — not part of the model's
 * contract. Persisted to candidates.profile_extraction_meta.
 */
export const extractionMetaSchema = z.object({
  model: z.string(),
  prompt_version: z.string(),
  extracted_at: z.string(),
  prompt_tokens: z.number().int().nonnegative().optional(),
  completion_tokens: z.number().int().nonnegative().optional(),
});

export type Profile = z.infer<typeof profileSchema>;
export type ExtractionMeta = z.infer<typeof extractionMetaSchema>;

/** Bump when the prompt or schema shape changes so old rows can be re-extracted. */
export const PROMPT_VERSION = "v2";

/**
 * JSON Schema fed to OpenAI's structured outputs. `target: "openAi"` emits
 * a draft-2019-09 schema with `additionalProperties: false` and every
 * property in `required` — exactly what strict mode demands.
 */
export const profileJsonSchema = zodToJsonSchema(profileSchema, {
  target: "openAi",
  $refStrategy: "none",
});

export const SYSTEM_PROMPT = `You extract a role-agnostic structured profile from a candidate's raw LinkedIn enrichment JSON. Output must conform to the provided JSON schema exactly.

Allowed enum values:
- seniority_band: junior | mid | senior | staff_plus | leadership | unknown
- stack_orientation: frontend | backend | fullstack | infra | data | ml | mobile | other | unknown
- company_stage_exposure (array, max 3): startup | scaleup | enterprise
- b2b_b2c: b2b | b2c | both | unknown
- tenure_pattern: job_hopper | normal | long_tenured | unknown
- archetype: generalist | specialist | hybrid | unknown
- track: ic | manager | mixed | unknown

industries is OPEN VOCABULARY. Use lowercased short names like "fintech", "healthtech", "devtools", "edtech". Max 4.

summary is 1-3 sentences, factual, role-agnostic. Describe what the candidate has done, not whether they fit any particular role.

key_skills: up to 10 short skill/technology names drawn from the enrichment.

years_experience is an integer (0-80) or null when it cannot be reasonably estimated.

recent_role_title: the candidate's most recent / current job title, lowercased and lightly normalized — drop seniority modifiers ("sr.", "senior", "lead", "ii", "iii"), drop "@ company" suffixes, but keep the craft ("software engineer", "product designer", "data scientist"). Empty string ONLY if no title can be determined.

recent_role_responsibilities: a deduplicated bullet list of responsibilities, duties, projects, technologies used, and quantified achievements. Scope rules:
- Start from the candidate's most recent role.
- ALSO include responsibilities from EVERY earlier role whose title is the same craft as recent_role_title. "Software engineer" matches "senior software engineer", "backend engineer", "software developer", "full-stack engineer". It does NOT match "product designer", "marketing manager", "founder" (unless the founder description shows the same craft work).
- EXCLUDE roles in unrelated fields even if they appear in the history.
- Scan the ENTIRE enrichment payload — experience descriptions, project descriptions, accomplishments fields, about/summary text — and pull bullets from anywhere that describes craft work performed during a matching role.
- Each entry is one short factual sentence, present tense, no first-person ("Built X", "Owned Y", "Reduced Z by 40%"). Strip company names and dates from the bullet — those belong in the experience field, not here.
- Up to 30 entries. If the candidate's history is small, fewer is fine.
- Empty array only if the enrichment has no matching responsibilities at all.

Rules:
- When a field cannot be confidently determined from the enrichment, emit "unknown" for enums, [] for arrays, "" for recent_role_title, or null for years_experience. Never fabricate.
- Be role-agnostic. Do not score, rank, or judge fit for any role. The output describes the candidate, not their fit.
- Do not invent companies, titles, skills, or responsibilities that are not present in the input.`;
