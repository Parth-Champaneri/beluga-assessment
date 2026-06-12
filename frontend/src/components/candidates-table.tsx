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
  const enrich = useMutation(
    trpc.candidates.enrichAll.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.candidates.list.queryKey(),
        }),
    }),
  );

  const pendingCount =
    candidates.data?.filter((c) => c.status === "queued").length ?? 0;
  const failedDispatches = enrich.data?.failed ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle>Candidates</CardTitle>
          {enrich.data && (
            <p className="text-xs text-muted-foreground">
              dispatched {enrich.data.dispatched}
              {failedDispatches.length > 0 &&
                `, ${failedDispatches.length} failed`}
            </p>
          )}
          {enrich.error && (
            <p className="text-xs text-red-600">
              error: {enrich.error.message}
            </p>
          )}
          {failedDispatches.length > 0 && (
            <ul className="text-xs text-red-600 list-disc pl-4 max-w-md">
              {failedDispatches.slice(0, 5).map((f) => (
                <li key={f.candidateId} className="truncate">
                  <span className="font-mono">{f.candidateId.slice(0, 8)}</span>
                  : {f.reason}
                </li>
              ))}
              {failedDispatches.length > 5 && (
                <li>… {failedDispatches.length - 5} more</li>
              )}
            </ul>
          )}
        </div>
        <Button
          onClick={() => enrich.mutate()}
          disabled={enrich.isPending || pendingCount === 0}
        >
          {enrich.isPending
            ? "Enriching…"
            : `Enrich pending (${pendingCount})`}
        </Button>
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
                          {c.lastErrorMessage && (
                            <div className="mb-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                              <span className="font-medium">
                                last error
                                {c.lastErrorCode
                                  ? ` (${c.lastErrorCode})`
                                  : ""}
                                :
                              </span>{" "}
                              {c.lastErrorMessage}
                            </div>
                          )}
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
