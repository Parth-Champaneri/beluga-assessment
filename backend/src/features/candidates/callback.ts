import { Router, json } from "express";
import { z } from "zod";
import { db } from "../../db/index.js";
import { env } from "../../lib/env.js";
import * as service from "./service.js";

const bodySchema = z.object({
  candidate_id: z.string().uuid(),
  enrichment_json: z.unknown(),
});

export const clayCallbackRouter: Router = Router();

clayCallbackRouter.post("/api/webhooks/clay", json(), async (req, res) => {
  const ip = req.ip ?? "?";
  if (req.header("x-callback-secret") !== env.CLAY_CALLBACK_SECRET) {
    console.warn(`[clay-callback] 401 bad secret from ${ip}`);
    res.status(401).json({ ok: false, error: "bad secret" });
    return;
  }
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    console.warn(
      `[clay-callback] 400 invalid body from ${ip}: ${parsed.error.message}`,
    );
    res.status(400).json({ ok: false, error: parsed.error.message });
    return;
  }
  const { candidate_id, enrichment_json } = parsed.data;
  const summary = summarizeEnrichment(enrichment_json);
  try {
    const updated = await service.applyCallback(
      { db },
      candidate_id,
      enrichment_json,
    );
    if (!updated) {
      console.warn(
        `[clay-callback] 404 unknown candidate=${candidate_id} from ${ip}`,
      );
      res.status(404).json({ ok: false, error: "unknown candidate_id" });
      return;
    }
    console.log(
      `[clay-callback] ← received candidate=${candidate_id} ${summary}`,
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(
      `[clay-callback] 500 error candidate=${candidate_id}:`,
      err,
    );
    res.status(500).json({ ok: false, error: "internal" });
  }
});

function summarizeEnrichment(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return `(non-object enrichment_json: ${typeof payload})`;
  }
  const obj = payload as Record<string, unknown>;
  const headline =
    typeof obj.headline === "string" ? obj.headline.slice(0, 60) : null;
  const keys = Object.keys(obj).length;
  return headline
    ? `headline="${headline}" (${keys} fields)`
    : `(${keys} fields, no headline)`;
}
