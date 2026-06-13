import { env } from "../../lib/env.js";
import {
  getClient,
  mapOpenAiError,
  type OpenAiResult,
} from "../../lib/openai.js";
import type { JobProfile } from "./job-schema.js";

/**
 * Fixed analyst persona. Stays byte-identical across all per-candidate
 * calls — together with the ROLE block of the user message it forms the
 * prefix OpenAI auto-caches when ≥1024 tokens.
 */
const SYSTEM_PROMPT = `You are a recruiting analyst. Given a role profile and a candidate profile, output ONE sentence of at most 15 words describing the strongest signal — positive or negative — about this candidate's fit for the role. Cite specifics: a skill match, years count, industry, or role-craft match. No hedging, no emoji, no preamble, no quotes. Output the sentence only.`;

type KV = Record<string, unknown>;

function pushKV(lines: string[], key: string, value: string | null): void {
  if (!value || !value.trim()) return;
  lines.push(`${key}=${value.trim()}`);
}

function fmtArr(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return v.filter((s) => typeof s === "string" && s.trim()).join(" ");
}

function fmtArrSemi(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return v.filter((s) => typeof s === "string" && s.trim()).join("; ");
}

function fmtNum(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function fmtEnum(v: unknown): string | null {
  if (typeof v !== "string" || !v || v === "unknown") return null;
  return v;
}

/**
 * Lean serialization for the explainer prompt — facets and the
 * recent-role-responsibilities bullets only. We deliberately skip raw
 * enrichment fields (experiences/education/projects) used in the
 * embedding-input builder: they bloat the per-call (non-cached) token
 * count for marginal gain on a 15-word output.
 */
function serializeJob(profile: JobProfile): string {
  const lines: string[] = [];
  pushKV(lines, "role_title", profile.role_title);
  pushKV(lines, "seniority_band", fmtEnum(profile.seniority_band));
  pushKV(lines, "stack_orientation", fmtEnum(profile.stack_orientation));
  pushKV(
    lines,
    "years_experience_required",
    fmtNum(profile.years_experience_required),
  );
  pushKV(lines, "b2b_b2c", fmtEnum(profile.b2b_b2c));
  pushKV(lines, "archetype_preference", fmtEnum(profile.archetype_preference));
  pushKV(lines, "track_preference", fmtEnum(profile.track_preference));
  pushKV(
    lines,
    "company_stage_exposure",
    fmtArr(profile.company_stage_exposure),
  );
  pushKV(lines, "industries", fmtArr(profile.industries));
  pushKV(lines, "required_skills", fmtArr(profile.required_skills));
  pushKV(lines, "nice_to_have_skills", fmtArr(profile.nice_to_have_skills));
  pushKV(lines, "responsibilities", fmtArrSemi(profile.responsibilities));
  pushKV(lines, "summary", profile.summary);
  return lines.join("\n");
}

function serializeCandidate(profile: KV): string {
  const lines: string[] = [];
  pushKV(
    lines,
    "recent_role_title",
    typeof profile.recent_role_title === "string"
      ? profile.recent_role_title
      : null,
  );
  pushKV(lines, "seniority_band", fmtEnum(profile.seniority_band));
  pushKV(lines, "stack_orientation", fmtEnum(profile.stack_orientation));
  pushKV(lines, "years_experience", fmtNum(profile.years_experience));
  pushKV(lines, "b2b_b2c", fmtEnum(profile.b2b_b2c));
  pushKV(lines, "tenure_pattern", fmtEnum(profile.tenure_pattern));
  pushKV(lines, "archetype", fmtEnum(profile.archetype));
  pushKV(lines, "track", fmtEnum(profile.track));
  pushKV(
    lines,
    "company_stage_exposure",
    fmtArr(profile.company_stage_exposure),
  );
  pushKV(lines, "industries", fmtArr(profile.industries));
  pushKV(lines, "key_skills", fmtArr(profile.key_skills));
  pushKV(
    lines,
    "recent_role_responsibilities",
    fmtArrSemi(profile.recent_role_responsibilities),
  );
  pushKV(
    lines,
    "summary",
    typeof profile.summary === "string" ? profile.summary : null,
  );
  return lines.join("\n");
}

export type MatchExplanation = {
  explanation: string;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  ms: number;
};

/**
 * One LLM call per candidate. Prompt is laid out so that
 * `system + "ROLE\n----\n" + serializeJob(...) + "\n\nCANDIDATE\n---------\n"`
 * is identical across every candidate evaluated against the same JD —
 * OpenAI's auto-prompt-cache picks this up when the prefix ≥1024 tokens
 * and the previous call was ≤5 min ago. Cache hit is visible via
 * `usage.prompt_tokens_details.cached_tokens`.
 */
export async function explainMatch(
  jdProfile: JobProfile,
  candidateProfile: unknown,
  candidateLabel: string,
): Promise<OpenAiResult<MatchExplanation>> {
  const client = getClient();
  if (!client) {
    return { ok: false, code: "config", message: "OPENAI_API_KEY is not set" };
  }

  if (!candidateProfile || typeof candidateProfile !== "object") {
    return {
      ok: false,
      code: "validation_failed",
      message: "candidate profile missing",
    };
  }

  const roleBlock = serializeJob(jdProfile);
  const candidateBlock = serializeCandidate(candidateProfile as KV);

  const userMessage =
    "ROLE\n----\n" +
    roleBlock +
    "\n\nCANDIDATE\n---------\n" +
    candidateBlock;

  const t0 = Date.now();
  let completion: Awaited<ReturnType<typeof client.chat.completions.create>>;
  try {
    completion = await client.chat.completions.create(
      {
        model: env.OPENAI_EXPLAIN_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      },
      { signal: AbortSignal.timeout(env.OPENAI_EXPLAIN_TIMEOUT_MS) },
    );
  } catch (err) {
    const mapped = mapOpenAiError(err);
    console.error(
      `[explain] ✗ candidate=${candidateLabel} code=${mapped.code} msg=${mapped.message}`,
    );
    return { ok: false, ...mapped };
  }

  const ms = Date.now() - t0;
  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    console.error(
      `[explain] ✗ candidate=${candidateLabel} code=validation_failed msg=empty response`,
    );
    return {
      ok: false,
      code: "validation_failed",
      message: "empty response",
    };
  }

  const promptTokens = completion.usage?.prompt_tokens ?? 0;
  const completionTokens = completion.usage?.completion_tokens ?? 0;
  const cachedTokens =
    (
      completion.usage as
        | { prompt_tokens_details?: { cached_tokens?: number } }
        | undefined
    )?.prompt_tokens_details?.cached_tokens ?? 0;

  console.log(
    `[explain] ✓ candidate=${candidateLabel} tokens=${promptTokens}/${completionTokens} cached=${cachedTokens} ms=${ms}`,
  );

  return {
    ok: true,
    value: {
      explanation: content,
      promptTokens,
      cachedTokens,
      completionTokens,
      ms,
    },
  };
}
