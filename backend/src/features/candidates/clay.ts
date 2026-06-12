import { env } from "../../lib/env.js";
import { dispatchToClayMock } from "./clay-mock.js";

export type ClayDispatchInput = {
  candidate_id: string;
  full_name: string;
  linkedin_url: string;
  email: string | null;
};

export type DispatchErrorCode =
  | "http_429"
  | "http_5xx"
  | "http_4xx"
  | "network"
  | "timeout"
  | "config";

export type DispatchResult =
  | { ok: true }
  | {
      ok: false;
      code: DispatchErrorCode;
      message: string;
      retryAfterSeconds?: number;
    };

/**
 * Normalize CLAY_MOCK_MODE — accepts "1", "true", "yes", "on" (any case)
 * as truthy; everything else (including empty/undefined) is falsy.
 */
function isMockMode(): boolean {
  const raw = env.CLAY_MOCK_MODE;
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Parse Retry-After header. Spec allows either an integer (seconds) or an
 * HTTP-date — we only honor the numeric form, log+ignore the date variant.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // Numeric seconds form
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  console.warn(
    `[clay] Retry-After in HTTP-date form ignored: "${trimmed}"`,
  );
  return undefined;
}

export async function dispatchToClay(
  input: ClayDispatchInput,
): Promise<DispatchResult> {
  if (isMockMode()) {
    return dispatchToClayMock(input);
  }

  if (!env.CLAY_WEBHOOK_URL || !env.CLAY_WEBHOOK_AUTH) {
    return {
      ok: false,
      code: "config",
      message:
        "Clay not configured: set CLAY_WEBHOOK_URL and CLAY_WEBHOOK_AUTH",
    };
  }

  // AbortController-driven timeout. Prefer AbortSignal.timeout where
  // available (Node 18+); fall back to a manual setTimeout abort.
  const timeoutMs = env.ENRICH_DISPATCH_TIMEOUT_MS;
  let signal: AbortSignal;
  let manualTimer: ReturnType<typeof setTimeout> | null = null;
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    signal = (AbortSignal as unknown as {
      timeout: (ms: number) => AbortSignal;
    }).timeout(timeoutMs);
  } else {
    const controller = new AbortController();
    manualTimer = setTimeout(() => controller.abort(), timeoutMs);
    signal = controller.signal;
  }

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(env.CLAY_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clay-webhook-auth": env.CLAY_WEBHOOK_AUTH,
      },
      body: JSON.stringify(input),
      signal,
    });
  } catch (err) {
    if (manualTimer) clearTimeout(manualTimer);
    // AbortError → timeout. Everything else → network.
    const name = err instanceof Error ? err.name : "";
    const reason = err instanceof Error ? err.message : String(err);
    if (name === "AbortError" || name === "TimeoutError") {
      console.error(
        `[clay] ✗ timeout candidate=${input.candidate_id} after ${timeoutMs}ms`,
      );
      return {
        ok: false,
        code: "timeout",
        message: `dispatch timed out after ${timeoutMs}ms`,
      };
    }
    console.error(
      `[clay] ✗ network error candidate=${input.candidate_id} reason=${reason}`,
    );
    return { ok: false, code: "network", message: reason };
  } finally {
    if (manualTimer) clearTimeout(manualTimer);
  }

  const ms = Date.now() - t0;

  if (res.status >= 200 && res.status < 300) {
    console.log(
      `[clay] → ack ${res.status} candidate=${input.candidate_id} (${ms}ms)`,
    );
    return { ok: true };
  }

  const body = await res.text().catch(() => "");
  const trimmedBody = body.slice(0, 200);

  if (res.status === 429) {
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    console.error(
      `[clay] ✗ HTTP 429 candidate=${input.candidate_id} (${ms}ms) retryAfter=${retryAfter ?? "?"} body=${trimmedBody}`,
    );
    return {
      ok: false,
      code: "http_429",
      message: `HTTP 429: ${trimmedBody}`,
      retryAfterSeconds: retryAfter,
    };
  }

  if (res.status >= 500) {
    console.error(
      `[clay] ✗ HTTP ${res.status} candidate=${input.candidate_id} (${ms}ms) body=${trimmedBody}`,
    );
    return {
      ok: false,
      code: "http_5xx",
      message: `HTTP ${res.status}: ${trimmedBody}`,
    };
  }

  // Other 4xx
  console.error(
    `[clay] ✗ HTTP ${res.status} candidate=${input.candidate_id} (${ms}ms) body=${trimmedBody}`,
  );
  return {
    ok: false,
    code: "http_4xx",
    message: `HTTP ${res.status}: ${trimmedBody}`,
  };
}
