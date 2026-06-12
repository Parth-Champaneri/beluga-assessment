import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Result = {
  inserted: number;
  updated: number;
  errors: { row: number; reason: string }[];
};

export function CsvUpload() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const queryClient = useQueryClient();
  const ingest = useMutation(
    trpc.candidates.ingestCsv.mutationOptions({
      onSuccess: (data) => {
        setResult(data);
        queryClient.invalidateQueries({
          queryKey: trpc.candidates.list.queryKey(),
        });
      },
    }),
  );

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setCsvText(await file.text());
    setResult(null);
  }

  function onSubmit() {
    if (!csvText) return;
    ingest.mutate({ csvText });
  }

  function onReset() {
    setFileName(null);
    setCsvText(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload candidates</CardTitle>
        <CardDescription>
          CSV with columns <code>full_name</code>, <code>linkedin_url</code>,{" "}
          and optional <code>email</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          className="text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/80"
        />
        <div className="flex items-center gap-2">
          <Button
            onClick={onSubmit}
            disabled={!csvText || ingest.isPending}
          >
            {ingest.isPending ? "Uploading…" : "Submit"}
          </Button>
          {fileName && (
            <Button variant="ghost" onClick={onReset}>
              Reset
            </Button>
          )}
          {fileName && (
            <span className="text-sm text-muted-foreground truncate">
              {fileName}
            </span>
          )}
        </div>
        {ingest.error && (
          <div className="text-sm text-red-600">
            error: {ingest.error.message}
          </div>
        )}
        {result && (
          <div className="text-sm">
            <span className="font-medium">{result.inserted}</span> added,{" "}
            <span className="font-medium">{result.updated}</span> already
            existed
            {result.errors.length > 0 && (
              <span>, {result.errors.length} skipped</span>
            )}
            .
            {result.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {result.errors.slice(0, 5).map((e, i) => (
                  <li key={i}>
                    row {e.row}: {e.reason}
                  </li>
                ))}
                {result.errors.length > 5 && (
                  <li>… {result.errors.length - 5} more</li>
                )}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
