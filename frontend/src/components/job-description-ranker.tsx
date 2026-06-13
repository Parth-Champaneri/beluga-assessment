import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type JobProfileFacets = {
  role_title?: string;
  seniority_band?: string;
  stack_orientation?: string;
  archetype_preference?: string;
  track_preference?: string;
  required_skills?: string[];
  nice_to_have_skills?: string[];
  responsibilities?: string[];
  industries?: string[];
  summary?: string;
} | null;

type CandidateProfileFacets = {
  seniority_band?: string;
  stack_orientation?: string;
  archetype?: string;
  track?: string;
  recent_role_title?: string;
} | null;

type MatchCategory = "strong_match" | "good_match" | "low_match" | "irrelevant";
type SortKey = "similarity" | "category";
type SortDir = "asc" | "desc";

function formatSimilarity(s: number): string {
  return `${(s * 100).toFixed(1)}%`;
}

const CATEGORY_LABEL: Record<MatchCategory, string> = {
  strong_match: "Strong",
  good_match: "Good",
  low_match: "Low",
  irrelevant: "Irrelevant",
};

const CATEGORY_CLASS: Record<MatchCategory, string> = {
  strong_match:
    "border-transparent bg-green-600 text-white hover:bg-green-600/90",
  good_match:
    "border-transparent bg-yellow-500 text-white hover:bg-yellow-500/90",
  low_match:
    "border-transparent bg-orange-500 text-white hover:bg-orange-500/90",
  irrelevant: "border-transparent bg-red-600 text-white hover:bg-red-600/90",
};

const CATEGORY_ORDER: Record<MatchCategory, number> = {
  strong_match: 1,
  good_match: 2,
  low_match: 3,
  irrelevant: 4,
};

export function JobDescriptionRanker() {
  const [title, setTitle] = useState("");
  const [descriptionText, setDescriptionText] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("similarity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      // Default direction per column: similarity desc (best first), category asc (strong first).
      setSortDir(key === "category" ? "asc" : "desc");
    }
  };

  const ingest = useMutation(
    trpc.jobs.ingest.mutationOptions({
      onSuccess: (data) => {
        setJobId(data.id);
      },
    }),
  );

  const matches = useQuery({
    ...trpc.jobs.matches.queryOptions(
      { jobId: jobId ?? "", limit: 50 },
      { enabled: jobId !== null },
    ),
  });

  const explanations = useQuery({
    ...trpc.jobs.explainMatches.queryOptions(
      { jobId: jobId ?? "", limit: 50 },
      {
        // Only fire after matches has resolved with data — running both
        // queries in parallel would double-cost the first explainer pass
        // (cache window not yet warm).
        enabled: jobId !== null && (matches.data?.length ?? 0) > 0,
      },
    ),
  });

  const explanationByCandidate = new Map<
    string,
    {
      category: MatchCategory | null;
      explanation: string | null;
      errorCode?: string;
    }
  >();
  for (const row of explanations.data ?? []) {
    explanationByCandidate.set(row.candidateId, {
      category: row.category as MatchCategory | null,
      explanation: row.explanation,
      errorCode: row.errorCode,
    });
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (descriptionText.trim().length < 20) return;
    setJobId(null);
    ingest.mutate({
      title: title.trim() || null,
      descriptionText,
    });
  };

  const ingestedProfile = (ingest.data?.profile ?? null) as JobProfileFacets;
  const explainerPending =
    explanations.isLoading || explanations.isFetching;

  const sortedMatches = (() => {
    const rows = matches.data ?? [];
    if (rows.length === 0) return rows;
    const sorted = [...rows].sort((a, b) => {
      if (sortKey === "similarity") {
        return sortDir === "desc"
          ? b.similarity - a.similarity
          : a.similarity - b.similarity;
      }
      // Sort by category. Rows without an explanation yet (or failed) sort
      // last. Within the same category, tiebreak by similarity desc so the
      // strongest of each bucket floats to the top.
      const catA = explanationByCandidate.get(a.id)?.category;
      const catB = explanationByCandidate.get(b.id)?.category;
      const orderA = catA ? CATEGORY_ORDER[catA] : 99;
      const orderB = catB ? CATEGORY_ORDER[catB] : 99;
      if (orderA !== orderB) {
        return sortDir === "asc" ? orderA - orderB : orderB - orderA;
      }
      return b.similarity - a.similarity;
    });
    return sorted;
  })();

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rank candidates against a job description</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            placeholder="Role label (optional, e.g. 'Senior Backend Eng — Stripe')"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={ingest.isPending}
          />
          <Textarea
            placeholder="Paste the full job description here…"
            rows={10}
            value={descriptionText}
            onChange={(e) => setDescriptionText(e.target.value)}
            disabled={ingest.isPending}
            className="min-h-[200px] font-mono text-xs"
          />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={
                ingest.isPending || descriptionText.trim().length < 20
              }
            >
              {ingest.isPending ? "Extracting + embedding…" : "Find matches"}
            </Button>
            {ingest.error && (
              <span className="text-xs text-red-600">
                {ingest.error.message}
              </span>
            )}
            {ingest.data && (
              <span className="text-xs text-muted-foreground">
                JD ingested — role_title: {ingestedProfile?.role_title || "—"}
              </span>
            )}
          </div>
        </form>

        {ingestedProfile && (
          <details className="mt-6 rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Extracted JD profile
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted p-3 text-xs">
              {JSON.stringify(ingestedProfile, null, 2)}
            </pre>
          </details>
        )}

        {jobId && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-medium">
              Top matches
              {matches.data && (
                <span className="ml-1 text-muted-foreground">
                  ({matches.data.length})
                </span>
              )}
            </h3>
            {matches.isLoading ? (
              <div className="text-sm text-muted-foreground">
                computing similarity…
              </div>
            ) : matches.error ? (
              <div className="text-sm text-red-600">
                {matches.error.message}
              </div>
            ) : !matches.data || matches.data.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No candidates have embeddings yet — upload a CSV and let
                enrichment + profile extraction finish.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Candidate</TableHead>
                    <TableHead className="w-28">
                      <button
                        type="button"
                        onClick={() => toggleSort("category")}
                        className="font-medium hover:text-foreground"
                      >
                        Match{sortIndicator("category")}
                      </button>
                    </TableHead>
                    <TableHead className="w-24">
                      <button
                        type="button"
                        onClick={() => toggleSort("similarity")}
                        className="font-medium hover:text-foreground"
                      >
                        Similarity{sortIndicator("similarity")}
                      </button>
                    </TableHead>
                    <TableHead>Why</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedMatches.map((m, i) => {
                    const profile = (m.profile ?? null) as CandidateProfileFacets;
                    const facetTags = [
                      profile?.recent_role_title,
                      profile?.seniority_band,
                      profile?.stack_orientation,
                      profile?.archetype,
                      profile?.track,
                    ].filter(
                      (v): v is string =>
                        typeof v === "string" &&
                        v.length > 0 &&
                        v !== "unknown",
                    );
                    const exp = explanationByCandidate.get(m.id);
                    return (
                      <TableRow key={m.id} className="align-top">
                        <TableCell className="text-xs text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{m.fullName}</div>
                          <a
                            href={m.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-muted-foreground underline"
                          >
                            {m.linkedinUrl.replace("https://linkedin.com", "")}
                          </a>
                          {facetTags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {facetTags.map((t) => (
                                <Badge
                                  key={t}
                                  variant="secondary"
                                  className="font-mono text-[10px]"
                                >
                                  {t}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {exp?.category ? (
                            <Badge className={CATEGORY_CLASS[exp.category]}>
                              {CATEGORY_LABEL[exp.category]}
                            </Badge>
                          ) : exp?.errorCode ? (
                            <span
                              title={exp.errorCode}
                              className="font-mono text-xs text-red-600"
                            >
                              ✗
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {explainerPending ? "…" : "—"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {formatSimilarity(m.similarity)}
                        </TableCell>
                        <TableCell className="text-xs italic text-muted-foreground">
                          {exp?.explanation ??
                            (exp?.errorCode
                              ? `— (${exp.errorCode})`
                              : explainerPending
                                ? "computing match…"
                                : "—")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
