import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  SENIORITY_BANDS,
  STACK_ORIENTATIONS,
  COMPANY_STAGES,
  B2B_B2C,
  ARCHETYPES,
  TRACKS,
} from "../candidates/profile-schema.js";

/**
 * The extracted JD profile. Field names deliberately overlap the candidate
 * profile (seniority_band, stack_orientation, industries…) so the cosine
 * similarity between their embeddings doesn't waste capacity on syntactic
 * differences. Required-vs-preferred axes match by intent: the JD
 * `required_skills` aligns to candidate `key_skills`, `responsibilities`
 * aligns to candidate `recent_role_responsibilities`, etc.
 */
export const jobProfileSchema = z.object({
  /**
   * Normalized title (e.g., "senior backend engineer"). Lowercased,
   * seniority modifier kept (unlike candidate side — for the JD the
   * seniority *is* part of the role identity).
   */
  role_title: z.string().max(120),
  seniority_band: z.enum(SENIORITY_BANDS),
  stack_orientation: z.enum(STACK_ORIENTATIONS),
  /** Stages the JD is targeted at — "we're a Series B startup" → ["scaleup"]. */
  company_stage_exposure: z.array(z.enum(COMPANY_STAGES)).max(3),
  b2b_b2c: z.enum(B2B_B2C),
  /** Open-vocab industries, same conventions as candidate side. */
  industries: z.array(z.string()).max(4),
  /** Minimum years experience requested. null if not stated. */
  years_experience_required: z.number().int().min(0).max(80).nullable(),
  /** Whether the JD reads as wanting a specialist, generalist, or hybrid. */
  archetype_preference: z.enum(ARCHETYPES),
  /** IC vs management track the JD is hiring for. */
  track_preference: z.enum(TRACKS),
  /** Must-have skills / technologies. Lowercased short names. */
  required_skills: z.array(z.string()).max(15),
  /** Plus-points / preferred skills. */
  nice_to_have_skills: z.array(z.string()).max(15),
  /** Day-to-day responsibilities, one short sentence each. */
  responsibilities: z.array(z.string().max(400)).max(30),
  /** Concise 1-3 sentence summary of the role. */
  summary: z.string().min(1).max(800),
});

export type JobProfile = z.infer<typeof jobProfileSchema>;

/** Bump when the prompt or schema shape changes. */
export const JOB_PROMPT_VERSION = "v1";

export const jobProfileJsonSchema = zodToJsonSchema(jobProfileSchema, {
  target: "openAi",
  $refStrategy: "none",
});

export const JOB_SYSTEM_PROMPT = `You extract a structured profile from a raw job description (JD). Output must conform to the provided JSON schema exactly.

Allowed enum values:
- seniority_band: junior | mid | senior | staff_plus | leadership | unknown
- stack_orientation: frontend | backend | fullstack | infra | data | ml | mobile | other | unknown
- company_stage_exposure (array, max 3): startup | scaleup | enterprise
- b2b_b2c: b2b | b2c | both | unknown
- archetype_preference: generalist | specialist | hybrid | unknown
- track_preference: ic | manager | mixed | unknown

role_title: lowercased, lightly normalized job title. Keep the seniority modifier ("senior backend engineer", not just "backend engineer") — for a JD the level IS part of the role identity. Empty string ONLY if no title can be determined.

industries: OPEN VOCABULARY. Lowercased short names ("fintech", "healthtech", "devtools"). Max 4.

required_skills vs nice_to_have_skills: read the JD carefully. "Required" / "must have" / "you have" → required_skills. "Nice to have" / "bonus" / "preferred" → nice_to_have_skills. If the JD doesn't distinguish, put everything in required_skills and leave nice_to_have_skills empty.

responsibilities: bullets describing what the person will do day-to-day. Each entry is one short factual sentence in present tense ("Own the payment platform", "Mentor junior engineers"). Drop fluff and benefits.

summary: 1-3 factual sentences about the role. Not a sales pitch.

years_experience_required: minimum years if stated (e.g. "5+ years of backend experience" → 5). null if not stated.

Rules:
- When a field cannot be confidently determined from the JD, emit "unknown" for enums, [] for arrays, "" for role_title, or null for years_experience_required. Never fabricate.
- Do not invent skills, responsibilities, or constraints that are not in the JD.
- Be neutral. Do not score, judge, or describe the candidate this would suit — describe the role.`;
