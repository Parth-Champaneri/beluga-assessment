import { env } from "../../lib/env.js";

export type ClayDispatchInput = {
  candidate_id: string;
  full_name: string;
  linkedin_url: string;
  email: string | null;
};

export async function dispatchToClay(input: ClayDispatchInput): Promise<void> {
  if (!env.CLAY_WEBHOOK_URL || !env.CLAY_WEBHOOK_AUTH) {
    throw new Error(
      "Clay not configured: set CLAY_WEBHOOK_URL and CLAY_WEBHOOK_AUTH",
    );
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
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[clay] ✗ network error candidate=${input.candidate_id} reason=${reason}`,
    );
    throw new Error(`network: ${reason}`);
  }
  const ms = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      `[clay] ✗ HTTP ${res.status} candidate=${input.candidate_id} (${ms}ms) body=${body.slice(0, 200)}`,
    );
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  console.log(
    `[clay] → ack ${res.status} candidate=${input.candidate_id} (${ms}ms)`,
  );
}
