import type { Profile } from "./profile-schema.js";

/**
 * text-embedding-3-large accepts 8192 tokens (~30k chars). Cap at 28k chars
 * to leave headroom for BPE expansion on dense JSON-y text.
 */
const MAX_LEN = 28000;

/**
 * Strip JSON-syntax noise from a free-text value so embeddings see prose,
 * not punctuation. Keeps inline commas (natural language uses them) but
 * removes quotes, braces, and brackets — those are JSON structure, not
 * signal — and collapses whitespace including newlines.
 */
function stripJunk(s: string): string {
  return s
    .replace(/["{}\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return stripJunk(v) || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function firstStringField(
  obj: unknown,
  ...keys: string[]
): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = asString(o[k]);
    if (v) return v;
  }
  return null;
}

function firstArrayField(obj: unknown, ...keys: string[]): unknown[] {
  if (!obj || typeof obj !== "object") return [];
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function formatExperience(exp: unknown): string | null {
  if (!exp || typeof exp !== "object") return null;
  const title = firstStringField(exp, "title", "position", "role", "job_title");
  const company = firstStringField(
    exp,
    "company",
    "company_name",
    "organization",
    "employer",
  );
  const dates = firstStringField(
    exp,
    "dates",
    "date_range",
    "duration",
    "period",
  );
  const location = firstStringField(exp, "location", "city");
  const description = firstStringField(
    exp,
    "description",
    "summary",
    "details",
  );

  const head = [title, company && `at ${company}`, dates && `(${dates})`]
    .filter(Boolean)
    .join(" ")
    .trim();
  const tail = [location && `in ${location}`, description && `- ${description}`]
    .filter(Boolean)
    .join(" ")
    .trim();
  const joined = [head, tail].filter(Boolean).join(" ").trim();
  return joined || null;
}

function formatEducation(edu: unknown): string | null {
  if (!edu || typeof edu !== "object") return null;
  const school = firstStringField(
    edu,
    "school",
    "school_name",
    "institution",
    "university",
  );
  const degree = firstStringField(edu, "degree", "degree_name");
  const field = firstStringField(edu, "field_of_study", "field", "major");
  const dates = firstStringField(edu, "dates", "date_range", "duration", "year");

  const subject = [degree, field && `in ${field}`].filter(Boolean).join(" ");
  const where = school && `at ${school}`;
  const when = dates && `(${dates})`;
  const joined = [subject, where, when].filter(Boolean).join(" ").trim();
  return joined || null;
}

function formatProject(proj: unknown): string | null {
  if (!proj || typeof proj !== "object") return null;
  const name = firstStringField(proj, "name", "title", "project_name");
  const description = firstStringField(proj, "description", "summary");
  const joined = [name, description && `- ${description}`]
    .filter(Boolean)
    .join(" ")
    .trim();
  return joined || null;
}

function formatCertification(cert: unknown): string | null {
  if (typeof cert === "string") return stripJunk(cert) || null;
  if (!cert || typeof cert !== "object") return null;
  const name = firstStringField(cert, "name", "title", "certification");
  const issuer = firstStringField(cert, "issuer", "organization", "authority");
  const joined = [name, issuer && `(${issuer})`]
    .filter(Boolean)
    .join(" ")
    .trim();
  return joined || null;
}

function mapItems(
  arr: unknown[],
  fn: (x: unknown) => string | null,
): string[] {
  return arr.map(fn).filter((s): s is string => Boolean(s));
}

function stringArrayField(obj: unknown, ...keys: string[]): string[] {
  const arr = firstArrayField(obj, ...keys);
  return mapItems(arr, asString);
}

function pushKV(lines: string[], key: string, value: string | null): void {
  if (!value) return;
  lines.push(`${key}=${value}`);
}

/**
 * Format profile facets + raw enrichment as a newline-separated
 * `key=value` block. Pure prose, no JSON syntax — the model reads this
 * as natural text and the embedding stays focused on signal, not
 * punctuation. Multi-item fields use `; ` between items so the embedding
 * still sees boundaries.
 */
export function buildEmbeddingInput(
  profile: Profile,
  enrichment: unknown,
): string {
  const lines: string[] = [];

  pushKV(lines, "seniority_band", profile.seniority_band);
  pushKV(lines, "stack_orientation", profile.stack_orientation);
  if (profile.years_experience !== null) {
    pushKV(lines, "years_experience", String(profile.years_experience));
  }
  pushKV(lines, "b2b_b2c", profile.b2b_b2c);
  pushKV(lines, "tenure_pattern", profile.tenure_pattern);
  pushKV(lines, "archetype", profile.archetype);
  pushKV(lines, "track", profile.track);
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
  if (profile.key_skills.length > 0) {
    pushKV(lines, "key_skills", profile.key_skills.map(stripJunk).join(" "));
  }
  pushKV(lines, "summary", stripJunk(profile.summary));
  if (profile.recent_role_title.trim().length > 0) {
    pushKV(lines, "recent_role_title", stripJunk(profile.recent_role_title));
  }
  if (profile.recent_role_responsibilities.length > 0) {
    pushKV(
      lines,
      "recent_role_responsibilities",
      profile.recent_role_responsibilities.map(stripJunk).join("; "),
    );
  }

  // Enrichment-derived fields — defensive against missing/varying shapes.
  if (enrichment && typeof enrichment === "object") {
    const en = enrichment as Record<string, unknown>;

    pushKV(lines, "headline", firstStringField(en, "headline", "title"));
    pushKV(lines, "location", firstStringField(en, "location", "city", "country"));
    pushKV(
      lines,
      "about",
      firstStringField(en, "about", "summary", "bio", "description"),
    );
    pushKV(
      lines,
      "current_company",
      firstStringField(en, "current_company", "company", "employer"),
    );
    pushKV(
      lines,
      "industry",
      firstStringField(en, "industry", "current_industry"),
    );

    const experiences = mapItems(
      firstArrayField(en, "experiences", "experience", "work_experience", "positions"),
      formatExperience,
    );
    if (experiences.length > 0) {
      pushKV(lines, "experience", experiences.join("; "));
    }

    const educations = mapItems(
      firstArrayField(en, "educations", "education", "schools"),
      formatEducation,
    );
    if (educations.length > 0) {
      pushKV(lines, "education", educations.join("; "));
    }

    const projects = mapItems(
      firstArrayField(en, "projects", "project"),
      formatProject,
    );
    if (projects.length > 0) {
      pushKV(lines, "projects", projects.join("; "));
    }

    const certs = mapItems(
      firstArrayField(en, "certifications", "certs", "licenses"),
      formatCertification,
    );
    if (certs.length > 0) {
      pushKV(lines, "certifications", certs.join("; "));
    }

    const enrichmentSkills = stringArrayField(
      en,
      "skills",
      "skill_list",
      "top_skills",
    );
    if (enrichmentSkills.length > 0) {
      pushKV(lines, "enrichment_skills", enrichmentSkills.join(" "));
    }
  }

  const out = lines.join("\n");
  if (out.length <= MAX_LEN) return out;
  return `${out.slice(0, MAX_LEN - 1)}…`;
}
