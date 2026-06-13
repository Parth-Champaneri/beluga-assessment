import type { JobProfile } from "./job-schema.js";

const MAX_LEN = 28000;

function stripJunk(s: string): string {
  return s
    .replace(/["{}\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pushKV(lines: string[], key: string, value: string | null): void {
  if (!value) return;
  lines.push(`${key}=${value}`);
}

/**
 * Build the key=value text fed to `text-embedding-3-large`. Field names
 * deliberately mirror the candidate-side builder where the concepts
 * overlap (seniority_band, stack_orientation, industries…) so the cosine
 * similarity between a JD embedding and a candidate embedding picks up
 * role-fit rather than syntactic differences.
 */
export function buildJobEmbeddingInput(profile: JobProfile): string {
  const lines: string[] = [];

  if (profile.role_title.trim().length > 0) {
    pushKV(lines, "role_title", stripJunk(profile.role_title));
  }
  pushKV(lines, "seniority_band", profile.seniority_band);
  pushKV(lines, "stack_orientation", profile.stack_orientation);
  if (profile.years_experience_required !== null) {
    pushKV(
      lines,
      "years_experience_required",
      String(profile.years_experience_required),
    );
  }
  pushKV(lines, "b2b_b2c", profile.b2b_b2c);
  pushKV(lines, "archetype_preference", profile.archetype_preference);
  pushKV(lines, "track_preference", profile.track_preference);
  if (profile.company_stage_exposure.length > 0) {
    pushKV(
      lines,
      "company_stage_exposure",
      profile.company_stage_exposure.join(" "),
    );
  }
  if (profile.industries.length > 0) {
    pushKV(lines, "industries", profile.industries.map(stripJunk).join(" "));
  }
  if (profile.required_skills.length > 0) {
    pushKV(
      lines,
      "required_skills",
      profile.required_skills.map(stripJunk).join(" "),
    );
  }
  if (profile.nice_to_have_skills.length > 0) {
    pushKV(
      lines,
      "nice_to_have_skills",
      profile.nice_to_have_skills.map(stripJunk).join(" "),
    );
  }
  if (profile.responsibilities.length > 0) {
    pushKV(
      lines,
      "responsibilities",
      profile.responsibilities.map(stripJunk).join("; "),
    );
  }
  pushKV(lines, "summary", stripJunk(profile.summary));

  const out = lines.join("\n");
  if (out.length <= MAX_LEN) return out;
  return `${out.slice(0, MAX_LEN - 1)}…`;
}
