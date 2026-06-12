import type { Profile } from "./profile-schema.js";

const MAX_LEN = 4000;

function extractRecentTitles(enrichment: unknown): string[] {
  if (!enrichment || typeof enrichment !== "object") return [];
  const experiences = (enrichment as { experiences?: unknown }).experiences;
  if (!Array.isArray(experiences)) return [];

  const seen = new Set<string>();
  const titles: string[] = [];
  for (const exp of experiences) {
    if (!exp || typeof exp !== "object") continue;
    const title = (exp as { title?: unknown }).title;
    if (typeof title !== "string") continue;
    const trimmed = title.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    titles.push(trimmed);
    if (titles.length >= 5) break;
  }
  return titles;
}

function buildOpeningLine(profile: Profile): string {
  const seniority =
    profile.seniority_band === "unknown" ? "" : profile.seniority_band;
  const stack =
    profile.stack_orientation === "unknown" ? "" : profile.stack_orientation;
  const descriptor = [seniority, stack].filter(Boolean).join(" ");
  const subject = descriptor ? `${descriptor} engineer` : "Engineer";
  const years = profile.years_experience;
  if (typeof years === "number") {
    return `${subject}. ${years} years experience.`;
  }
  return `${subject}.`;
}

/**
 * Format a profile + raw enrichment into the text we feed to the embedding model.
 * Kept pure and dependency-free so it's auditable and testable in isolation.
 */
export function buildEmbeddingInput(
  profile: Profile,
  enrichment: unknown,
): string {
  const lines: string[] = [];

  lines.push(buildOpeningLine(profile));

  const stageBits: string[] = [];
  if (profile.b2b_b2c !== "unknown") {
    stageBits.push(`B2B/B2C: ${profile.b2b_b2c}`);
  }
  if (profile.company_stage_exposure.length > 0) {
    stageBits.push(
      `Stage exposure: ${profile.company_stage_exposure.join(", ")}`,
    );
  }
  if (stageBits.length > 0) {
    lines.push(`${stageBits.join(". ")}.`);
  }

  if (profile.industries.length > 0) {
    lines.push(`Industries: ${profile.industries.join(", ")}.`);
  }

  const traitBits: string[] = [];
  if (profile.archetype !== "unknown") {
    traitBits.push(`Archetype: ${profile.archetype}`);
  }
  if (profile.track !== "unknown") {
    traitBits.push(`Track: ${profile.track}`);
  }
  if (traitBits.length > 0) {
    lines.push(`${traitBits.join(". ")}.`);
  }

  const sections: string[] = [lines.join("\n")];

  if (profile.key_skills.length > 0) {
    sections.push(`Skills: ${profile.key_skills.join(", ")}.`);
  }

  if (profile.summary.trim().length > 0) {
    sections.push(`Summary: ${profile.summary}`);
  }

  const titles = extractRecentTitles(enrichment);
  if (titles.length > 0) {
    sections.push(`Recent titles: ${titles.join(" | ")}`);
  }

  const out = sections.join("\n\n");
  if (out.length <= MAX_LEN) return out;
  return `${out.slice(0, MAX_LEN - 1)}…`;
}
