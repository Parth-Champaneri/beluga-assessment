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
  const res = await fetch(env.CLAY_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-clay-webhook-auth": env.CLAY_WEBHOOK_AUTH,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Clay POST ${res.status}: ${body.slice(0, 200)}`);
  }
}
