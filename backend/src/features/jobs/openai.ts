import { env } from "../../lib/env.js";
import {
  getClient,
  mapOpenAiError,
  type OpenAiResult,
} from "../../lib/openai.js";
import {
  extractionMetaSchema,
  type ExtractionMeta,
} from "../candidates/profile-schema.js";
import {
  jobProfileSchema,
  jobProfileJsonSchema,
  JOB_SYSTEM_PROMPT,
  JOB_PROMPT_VERSION,
  type JobProfile,
} from "./job-schema.js";

// Re-export so callers don't need to know about lib/openai.
export { embedText } from "../../lib/openai.js";

/**
 * Send the raw JD text to the extraction model and return a validated
 * `JobProfile` plus an `ExtractionMeta`. Same shape as the candidate-side
 * extractor for symmetry; the caller decides whether to fail the request
 * synchronously (JD ingest is interactive) or retry.
 */
export async function extractJobProfile(
  descriptionText: string,
): Promise<OpenAiResult<{ profile: JobProfile; extractionMeta: ExtractionMeta }>> {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      code: "config",
      message: "OPENAI_API_KEY is not set",
    };
  }

  const userMessage = "Job description:\n\n" + descriptionText;

  const t0 = Date.now();
  let completion: Awaited<
    ReturnType<typeof client.chat.completions.create>
  >;
  try {
    completion = await client.chat.completions.create(
      {
        model: env.OPENAI_EXTRACTION_MODEL,
        messages: [
          { role: "system", content: JOB_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "job_profile",
            strict: true,
            schema: jobProfileJsonSchema as Record<string, unknown>,
          },
        },
      },
      { signal: AbortSignal.timeout(env.OPENAI_TIMEOUT_MS) },
    );
  } catch (err) {
    const mapped = mapOpenAiError(err);
    console.error(
      `[openai] ✗ extract(job) code=${mapped.code} msg=${mapped.message}`,
    );
    return { ok: false, ...mapped };
  }

  const ms = Date.now() - t0;
  const content = completion.choices[0]?.message?.content;
  if (!content) {
    console.error(
      `[openai] ✗ extract(job) code=validation_failed msg=empty response`,
    );
    return {
      ok: false,
      code: "validation_failed",
      message: "empty response",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 500) : String(err);
    console.error(`[openai] ✗ extract(job) code=validation_failed msg=${msg}`);
    return { ok: false, code: "validation_failed", message: msg };
  }

  let profile: JobProfile;
  try {
    profile = jobProfileSchema.parse(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 500) : String(err);
    console.error(`[openai] ✗ extract(job) code=validation_failed msg=${msg}`);
    return { ok: false, code: "validation_failed", message: msg };
  }

  const extractionMeta: ExtractionMeta = extractionMetaSchema.parse({
    model: env.OPENAI_EXTRACTION_MODEL,
    prompt_version: JOB_PROMPT_VERSION,
    extracted_at: new Date().toISOString(),
    prompt_tokens: completion.usage?.prompt_tokens,
    completion_tokens: completion.usage?.completion_tokens,
  });

  console.log(
    `[openai] ✓ extract(job) model=${env.OPENAI_EXTRACTION_MODEL} tokens=${completion.usage?.prompt_tokens ?? "?"}/${completion.usage?.completion_tokens ?? "?"} ms=${ms}`,
  );
  return { ok: true, value: { profile, extractionMeta } };
}
