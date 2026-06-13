import OpenAI, { APIError } from "openai";
import { env } from "./env.js";

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
export function getClient(): OpenAI | null {
  if (!env.OPENAI_API_KEY) return null;
  if (!_client) _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _client;
}

export function mapOpenAiError(err: unknown): {
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

/**
 * Generic embedding call. Returns the raw vector. Both candidates and
 * job-descriptions embed via this — same model, same vector space, so
 * cosine similarity between them is meaningful.
 */
export async function embedText(
  text: string,
  context: string,
): Promise<OpenAiResult<number[]>> {
  const client = getClient();
  if (!client) {
    return { ok: false, code: "config", message: "OPENAI_API_KEY is not set" };
  }

  const t0 = Date.now();
  let response: Awaited<ReturnType<typeof client.embeddings.create>>;
  try {
    response = await client.embeddings.create(
      { model: env.OPENAI_EMBEDDING_MODEL, input: text },
      { signal: AbortSignal.timeout(env.OPENAI_TIMEOUT_MS) },
    );
  } catch (err) {
    const mapped = mapOpenAiError(err);
    console.error(
      `[openai] ✗ embed(${context}) code=${mapped.code} msg=${mapped.message}`,
    );
    return { ok: false, ...mapped };
  }

  const ms = Date.now() - t0;
  const embedding = response.data[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    console.error(
      `[openai] ✗ embed(${context}) code=validation_failed msg=no embedding in response`,
    );
    return {
      ok: false,
      code: "validation_failed",
      message: "no embedding in response",
    };
  }

  if (embedding.length !== 3072) {
    const msg = `expected 3072 dims, got ${embedding.length}`;
    console.error(
      `[openai] ✗ embed(${context}) code=validation_failed msg=${msg}`,
    );
    return { ok: false, code: "validation_failed", message: msg };
  }

  console.log(
    `[openai] ✓ embed(${context}) model=${env.OPENAI_EMBEDDING_MODEL} dims=${embedding.length} ms=${ms}`,
  );
  return { ok: true, value: embedding };
}
