import Papa from "papaparse";
import type { Context } from "../../trpc/context.js";
import * as repo from "./repo.js";
import type { NewCandidate } from "./schema.js";

export type IngestRowError = { row: number; reason: string };
export type IngestResult = {
  inserted: number;
  updated: number;
  errors: IngestRowError[];
};

export function normalizeLinkedinUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(
      trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
    );
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.endsWith("linkedin.com")) return null;
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    if (!path.startsWith("/in/")) return null;
    return `https://${host}${path}`;
  } catch {
    return null;
  }
}

export async function ingestCsv(
  ctx: Context,
  input: { csvText: string },
): Promise<IngestResult> {
  const parsed = Papa.parse<Record<string, string>>(input.csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });

  const errors: IngestRowError[] = [];
  const seenUrls = new Set<string>();
  const rows: NewCandidate[] = [];

  parsed.data.forEach((raw, i) => {
    const rowNum = i + 2; // header is row 1
    const fullName = (raw.full_name ?? raw.name ?? "").trim();
    const linkedinRaw = (raw.linkedin_url ?? raw.linkedin ?? "").trim();
    const email = (raw.email ?? "").trim() || null;

    if (!fullName) {
      errors.push({ row: rowNum, reason: "missing full_name" });
      return;
    }
    if (!linkedinRaw) {
      errors.push({ row: rowNum, reason: "missing linkedin_url" });
      return;
    }
    const linkedinUrl = normalizeLinkedinUrl(linkedinRaw);
    if (!linkedinUrl) {
      errors.push({ row: rowNum, reason: `invalid linkedin_url: ${linkedinRaw}` });
      return;
    }
    if (seenUrls.has(linkedinUrl)) {
      errors.push({ row: rowNum, reason: "duplicate linkedin_url in CSV" });
      return;
    }
    seenUrls.add(linkedinUrl);
    rows.push({ fullName, linkedinUrl, email });
  });

  const { inserted, updated } = await repo.upsertCandidates(ctx.db, rows);
  return { inserted, updated, errors };
}

export async function list(ctx: Context) {
  return repo.listCandidates(ctx.db);
}
