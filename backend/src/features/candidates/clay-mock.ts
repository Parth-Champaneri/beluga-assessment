import { env } from "../../lib/env.js";
import type { ClayDispatchInput, DispatchResult } from "./clay.js";

/**
 * djb2 hash over the candidate_id (uuid string). Stable across process
 * restarts, deterministic per-candidate. Returns a non-negative 32-bit int.
 */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/**
 * Fire a synthetic Clay callback against our own webhook endpoint after a
 * randomized 3–8s delay. Fire-and-forget; failures only log.
 */
function scheduleSyntheticCallback(input: ClayDispatchInput): void {
  const delayMs = 3000 + Math.floor(Math.random() * 5000);
  setTimeout(() => {
    const url = `http://localhost:${env.PORT}/api/webhooks/clay`;
    const body = {
      linkedin_url: input.linkedin_url,
      enrichment_json: {
        headline: "Mock Senior Engineer",
        location: "Mock City, US",
        experiences: [] as unknown[],
      },
    };
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-callback-secret": env.CLAY_CALLBACK_SECRET,
      },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) {
          console.warn(
            `[clay-mock] synthetic callback HTTP ${res.status} for candidate=${input.candidate_id}`,
          );
        } else {
          console.log(
            `[clay-mock] ✓ synthetic callback delivered candidate=${input.candidate_id} (delay=${delayMs}ms)`,
          );
        }
      })
      .catch((err) => {
        console.warn(
          `[clay-mock] synthetic callback failed candidate=${input.candidate_id} err=${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }, delayMs);
}

/**
 * Mock Clay provider. Bucketed deterministically by hash(candidate_id) % 10:
 *   0–6 (70%): respond 200 + schedule a delayed synthetic callback
 *   7   (10%): 429 with Retry-After: 30
 *   8   (10%): 500
 *   9   (10%): sleep past ENRICH_DISPATCH_TIMEOUT_MS, return timeout
 */
export async function dispatchToClayMock(
  input: ClayDispatchInput,
): Promise<DispatchResult> {
  const bucket = djb2(input.candidate_id) % 10;
  console.log(
    `[clay-mock] candidate=${input.candidate_id} bucket=${bucket}`,
  );

  if (bucket <= 6) {
    scheduleSyntheticCallback(input);
    return { ok: true };
  }

  if (bucket === 7) {
    return {
      ok: false,
      code: "http_429",
      message: "mock 429",
      retryAfterSeconds: 30,
    };
  }

  if (bucket === 8) {
    return { ok: false, code: "http_5xx", message: "mock 500" };
  }

  // bucket === 9: sleep slightly past the dispatch timeout, then return.
  const sleepMs = env.ENRICH_DISPATCH_TIMEOUT_MS + 500;
  await new Promise((resolve) => setTimeout(resolve, sleepMs));
  return { ok: false, code: "timeout", message: "mock never-respond" };
}
