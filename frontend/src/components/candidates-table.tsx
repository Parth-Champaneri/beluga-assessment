import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Mirrors backend `enrichmentJobStatuses`. `null` happens transiently if a
// candidate row exists without its job row (shouldn't, but be safe).
type Status = "queued" | "dispatched" | "done" | "failed" | null;

const statusVariant: Record<
  NonNullable<Status>,
  "default" | "secondary" | "outline" | "destructive"
> = {
  queued: "outline",
  dispatched: "secondary",
  done: "default",
  failed: "destructive",
};

// Must match backend ENRICH_MAX_ATTEMPTS default (env.ts). UI display only.
const MAX_ATTEMPTS = 5;

/**
 * Coarse "in N seconds/minutes/hours" formatter. Negative durations render
 * as "now" — we only show next-retry when it's in the future.
 */
function humanizeRelative(target: Date, now: Date): string {
  const deltaMs = target.getTime() - now.getTime();
  if (deltaMs <= 0) return "now";
  const seconds = Math.round(deltaMs / 1000);
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `in ${hours}h`;
}

export function CandidatesTable() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const candidates = useQuery(
    trpc.candidates.list.queryOptions(undefined, {
      refetchInterval: (q) => {
        const data = q.state.data as { status: Status }[] | undefined;
        return data?.some(
          (c) => c.status === "queued" || c.status === "dispatched",
        )
          ? 2000
          : false;
      },
    }),
  );

  const invalidateList = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.candidates.list.queryKey(),
    });

  const nudge = useMutation(
    trpc.candidates.nudgeQueued.mutationOptions({
      onSuccess: invalidateList,
    }),
  );
  const retry = useMutation(
    trpc.candidates.retryFailed.mutationOptions({
      onSuccess: invalidateList,
    }),
  );

  const queuedCount =
    candidates.data?.filter((c) => c.status === "queued").length ?? 0;
  const failedCount =
    candidates.data?.filter((c) => c.status === "failed").length ?? 0;

  const anyMutating = nudge.isPending || retry.isPending;
  const now = new Date();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle>Candidates</CardTitle>
          {nudge.data && (
            <p className="text-xs text-muted-foreground">
              queued {nudge.data.queued} for dispatch
            </p>
          )}
          {retry.data && (
            <p className="text-xs text-muted-foreground">
              reset {retry.data.reset} failed job(s)
            </p>
          )}
          {nudge.error && (
            <p className="text-xs text-red-600">
              error: {nudge.error.message}
            </p>
          )}
          {retry.error && (
            <p className="text-xs text-red-600">
              error: {retry.error.message}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => nudge.mutate()}
            disabled={anyMutating || queuedCount === 0}
          >
            {nudge.isPending
              ? "Enriching…"
              : `Enrich pending (${queuedCount})`}
          </Button>
          <Button
            variant="outline"
            onClick={() => retry.mutate()}
            disabled={anyMutating || failedCount === 0}
          >
            {retry.isPending
              ? "Retrying…"
              : `Retry failed (${failedCount})`}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {candidates.isLoading ? (
          <div className="text-sm text-muted-foreground">loading…</div>
        ) : candidates.error ? (
          <div className="text-sm text-red-600">
            error: {candidates.error.message}
          </div>
        ) : !candidates.data || candidates.data.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            no candidates yet — upload a CSV above.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>LinkedIn</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Headline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.data.map((c) => {
                const enrichment =
                  (c.enrichment ?? null) as { headline?: string } | null;
                const isOpen = expanded === c.id;
                const nextAttempt = c.nextAttemptAt
                  ? new Date(c.nextAttemptAt as unknown as string)
                  : null;
                const showNextRetry =
                  c.status === "queued" &&
                  nextAttempt !== null &&
                  nextAttempt.getTime() > now.getTime();
                return (
                  <>
                    <TableRow
                      key={c.id}
                      onClick={() => setExpanded(isOpen ? null : c.id)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-medium">
                        {c.fullName}
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate">
                        <a
                          href={c.linkedinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.linkedinUrl.replace("https://linkedin.com", "")}
                        </a>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.email ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {c.status && (
                            <Badge variant={statusVariant[c.status]}>
                              {c.status}
                            </Badge>
                          )}
                          {c.lastErrorMessage && (
                            <span
                              title={c.lastErrorMessage}
                              className="text-red-600"
                              aria-label="last error message"
                            >
                              ⚠
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-muted-foreground">
                        {enrichment?.headline ?? "—"}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow key={`${c.id}-expanded`}>
                        <TableCell colSpan={5}>
                          <div className="mb-2 flex flex-col gap-1 text-xs text-muted-foreground">
                            <div>
                              <span className="font-medium">Attempts:</span>{" "}
                              {c.attemptCount ?? 0} / {MAX_ATTEMPTS}
                            </div>
                            {showNextRetry && nextAttempt && (
                              <div>
                                <span className="font-medium">
                                  Next retry:
                                </span>{" "}
                                {humanizeRelative(nextAttempt, now)}
                              </div>
                            )}
                            {c.lastErrorCode && (
                              <div className="text-red-700">
                                <span className="font-medium">Error:</span>{" "}
                                <span className="font-mono">
                                  {c.lastErrorCode}
                                </span>
                                {c.lastErrorMessage
                                  ? ` — ${c.lastErrorMessage}`
                                  : ""}
                              </div>
                            )}
                          </div>
                          <pre className="max-h-72 overflow-auto rounded bg-muted p-3 text-xs">
                            {enrichment
                              ? JSON.stringify(enrichment, null, 2)
                              : "no enrichment yet"}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
