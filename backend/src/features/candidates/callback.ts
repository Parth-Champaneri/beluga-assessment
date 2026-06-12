import { Router, json } from "express";
import { z } from "zod";
import { db } from "../../db/index.js";
import { env } from "../../lib/env.js";
import * as service from "./service.js";

const bodySchema = z
  .object({ candidate_id: z.string().uuid() })
  .passthrough();

export const clayCallbackRouter: Router = Router();

clayCallbackRouter.post("/api/webhooks/clay", json(), async (req, res) => {
  if (req.header("x-callback-secret") !== env.CLAY_CALLBACK_SECRET) {
    res.status(401).json({ ok: false, error: "bad secret" });
    return;
  }
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.message });
    return;
  }
  const { candidate_id, ...payload } = parsed.data;
  try {
    const updated = await service.applyCallback(
      { db },
      candidate_id,
      payload,
    );
    if (!updated) {
      res.status(404).json({ ok: false, error: "unknown candidate_id" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[clay-callback] error", err);
    res.status(500).json({ ok: false, error: "internal" });
  }
});
