import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
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

type Status = "pending" | "sent" | "enriched";

const statusVariant: Record<
  Status,
  "default" | "secondary" | "outline"
> = {
  pending: "outline",
  sent: "secondary",
  enriched: "default",
};

export function CandidatesTable() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const candidates = useQuery(
    trpc.candidates.list.queryOptions(undefined, {
      refetchInterval: (q) => {
        const data = q.state.data as { status: Status }[] | undefined;
        return data?.some((c) => c.status === "sent") ? 2000 : false;
      },
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Candidates</CardTitle>
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
                        <Badge variant={statusVariant[c.status as Status]}>
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-muted-foreground">
                        {enrichment?.headline ?? "—"}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow key={`${c.id}-expanded`}>
                        <TableCell colSpan={5}>
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
