import OpenAI, { APIError } from "openai";
import { env } from "../../lib/env.js";
import {
  profileSchema,
  profileModelOutputSchema,
  profileJsonSchema,
  SYSTEM_PROMPT,
  PROMPT_VERSION,
  type Profile,
} from "./profile-schema.js";

export type OpenAiErrorCode =
  | "openai_429"
  | "openai_5xx"
  | "openai_4xx"
  | "network"
  | "timeout"
  | "validation_failed"
  | "config";

export type OpenAiResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: OpenAiErrorCode;
      message: string;
      retryAfterSeconds?: number;
    };

let _client: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (!env.OPENAI_API_KEY) return null;
  if (!_client) _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _client;
}

function mapOpenAiError(err: unknown): {
  code: OpenAiErrorCode;
  message: string;
  retryAfterSeconds?: number;
} {
  const message =
    err instanceof Error ? err.message.slice(0, 500) : String(err);

  if (err instanceof APIError) {
    const status = err.status ?? 0;
    if (status === 429) {
      const headers = err.headers as
        | Record<string, string | undefined>
        | undefined;
      const raw = headers?.["retry-after"];
      let retryAfterSeconds: number | undefined;
      if (raw && /^\d+$/.test(String(raw).trim())) {
        const n = Number(String(raw).trim());
        if (Number.isFinite(n) && n >= 0) retryAfterSeconds = n;
      }
      return { code: "openai_429", message, retryAfterSeconds };
    }
    if (status >= 500) return { code: "openai_5xx", message };
    if (status >= 400) return { code: "openai_4xx", message };
  }

  if (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  ) {
    return { code: "timeout", message };
  }

  return { code: "network", message };
}

export async function extractProfile(
  enrichment: unknown,
): Promise<OpenAiResult<{ profile: Profile; truncatedInput: boolean }>> {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      code: "config",
      message: "OPENAI_API_KEY is not set",
    };
  }

  const rawJson = JSON.stringify(enrichment, null, 2);
  const truncatedInput = rawJson.length > 30000;
  const truncatedJson = truncatedInput ? rawJson.slice(0, 30000) : rawJson;
  const userMessage = "Raw enrichment JSON:\n\n" + truncatedJson;

  const t0 = Date.now();
  let completion: Awaited<
    ReturnType<typeof client.chat.completions.create>
  >;
  try {
    completion = await client.chat.completions.create(
      {
        model: env.OPENAI_EXTRACTION_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "candidate_profile",
            strict: true,
            schema: profileJsonSchema as Record<string, unknown>,
          },
        },
      },
      { signal: AbortSignal.timeout(env.OPENAI_TIMEOUT_MS) },
    );
  } catch (err) {
    const mapped = mapOpenAiError(err);
    console.error(
      `[openai] ✗ extract code=${mapped.code} msg=${mapped.message}`,
    );
    return { ok: false, ...mapped };
  }

  const ms = Date.now() - t0;
  const content = completion.choices[0]?.message?.content;
  if (!content) {
    console.error(`[openai] ✗ extract code=validation_failed msg=empty response`);
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
    console.error(`[openai] ✗ extract code=validation_failed msg=${msg}`);
    return { ok: false, code: "validation_failed", message: msg };
  }

  // First validate the model's output (facets only). extraction_meta is
  // attached server-side — the model's contract excludes it so OpenAI's
  // strict structured-outputs mode is happy (all properties required +
  // additionalProperties: false).
  let profile: Profile;
  try {
    const modelOutput = profileModelOutputSchema.parse(parsed);
    profile = profileSchema.parse({
      ...modelOutput,
      extraction_meta: {
        model: env.OPENAI_EXTRACTION_MODEL,
        prompt_version: PROMPT_VERSION,
        extracted_at: new Date().toISOString(),
        prompt_tokens: completion.usage?.prompt_tokens,
        completion_tokens: completion.usage?.completion_tokens,
        truncated_input: truncatedInput,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 500) : String(err);
    console.error(`[openai] ✗ extract code=validation_failed msg=${msg}`);
    return { ok: false, code: "validation_failed", message: msg };
  }

  console.log(
    `[openai] ✓ extract model=${env.OPENAI_EXTRACTION_MODEL} tokens=${completion.usage?.prompt_tokens ?? "?"}/${completion.usage?.completion_tokens ?? "?"} ms=${ms}`,
  );
  return { ok: true, value: { profile, truncatedInput } };
}

export async function embedProfile(
  text: string,
): Promise<OpenAiResult<number[]>> {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      code: "config",
      message: "OPENAI_API_KEY is not set",
    };
  }

  const t0 = Date.now();
  let response: Awaited<ReturnType<typeof client.embeddings.create>>;
  try {
    response = await client.embeddings.create(
      {
        model: env.OPENAI_EMBEDDING_MODEL,
        input: text,
      },
      { signal: AbortSignal.timeout(env.OPENAI_TIMEOUT_MS) },
    );
  } catch (err) {
    const mapped = mapOpenAiError(err);
    console.error(
      `[openai] ✗ embed code=${mapped.code} msg=${mapped.message}`,
    );
    return { ok: false, ...mapped };
  }

  const ms = Date.now() - t0;
  const embedding = response.data[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    console.error(
      `[openai] ✗ embed code=validation_failed msg=no embedding in response`,
    );
    return {
      ok: false,
      code: "validation_failed",
      message: "no embedding in response",
    };
  }

  if (embedding.length !== 3072) {
    const msg = `expected 3072 dims, got ${embedding.length}`;
    console.error(`[openai] ✗ embed code=validation_failed msg=${msg}`);
    return { ok: false, code: "validation_failed", message: msg };
  }

  console.log(
    `[openai] ✓ embed model=${env.OPENAI_EMBEDDING_MODEL} dims=${embedding.length} ms=${ms}`,
  );
  return { ok: true, value: embedding };
}
