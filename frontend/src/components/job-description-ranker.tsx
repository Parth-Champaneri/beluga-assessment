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

function formatSimilarity(s: number): string {
  return `${(s * 100).toFixed(1)}%`;
}

function similarityVariant(
  s: number,
): "default" | "secondary" | "outline" | "destructive" {
  if (s >= 0.7) return "default";
  if (s >= 0.55) return "secondary";
  return "outline";
}

export function JobDescriptionRanker() {
  const [title, setTitle] = useState("");
  const [descriptionText, setDescriptionText] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

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
    { explanation: string | null; errorCode?: string }
  >();
  for (const row of explanations.data ?? []) {
    explanationByCandidate.set(row.candidateId, {
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
              <ol className="flex flex-col divide-y">
                {matches.data.map((m, i) => {
                  const profile = (m.profile ?? null) as CandidateProfileFacets;
                  const facetTags = [
                    profile?.recent_role_title,
                    profile?.seniority_band,
                    profile?.stack_orientation,
                    profile?.archetype,
                    profile?.track,
                  ].filter(
                    (v): v is string =>
                      typeof v === "string" && v.length > 0 && v !== "unknown",
                  );
                  const exp = explanationByCandidate.get(m.id);
                  const explainerPending =
                    explanations.isLoading || explanations.isFetching;
                  return (
                    <li
                      key={m.id}
                      className="flex items-start justify-between gap-3 py-2"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <span className="w-6 pt-0.5 text-right text-xs text-muted-foreground">
                          {i + 1}.
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{m.fullName}</div>
                          <p className="mt-0.5 text-xs italic text-muted-foreground">
                            {exp?.explanation ??
                              (exp?.errorCode
                                ? `— (${exp.errorCode})`
                                : explainerPending
                                  ? "computing match…"
                                  : "—")}
                          </p>
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
                        </div>
                      </div>
                      <Badge variant={similarityVariant(m.similarity)}>
                        {formatSimilarity(m.similarity)}
                      </Badge>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
