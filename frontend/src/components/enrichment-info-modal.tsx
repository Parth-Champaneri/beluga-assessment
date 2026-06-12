import { useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * "How enrichment works" reference modal — explains the job state machine,
 * retry mechanics, and the per-row error codes so reviewers can interpret
 * the dashboard at a glance.
 */
export function EnrichmentInfoModal() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => dialogRef.current?.showModal()}
      >
        How it works
      </Button>
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          // Clicks on the dialog element itself (i.e. the backdrop area)
          // close it; clicks inside the content panel are stopped below.
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto w-full max-w-2xl rounded-lg border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50"
      >
        <div
          className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">How enrichment works</h2>
              <p className="text-xs text-muted-foreground">
                The job state machine, retry mechanics, and what each error
                code means.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
            >
              ✕
            </Button>
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">State machine</h3>
            <p className="text-xs text-muted-foreground">
              Each candidate has exactly one enrichment job. Status flow:
            </p>
            <pre className="rounded bg-muted p-3 font-mono text-xs leading-relaxed">
              {`queued ─► dispatched ─► done
                  │
                  └─► failed   (dead-letter queue)`}
            </pre>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Statuses</h3>
            <ul className="flex flex-col gap-2 text-xs">
              <li className="flex items-start gap-2">
                <Badge variant="outline" className="shrink-0">
                  queued
                </Badge>
                <span className="text-muted-foreground">
                  Waiting for the worker. The dispatcher claims due rows
                  every 3 seconds, up to 20 at a time.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Badge variant="secondary" className="shrink-0">
                  dispatched
                </Badge>
                <span className="text-muted-foreground">
                  POSTed to Clay successfully (2xx). Awaiting Clay's async
                  webhook callback. Fire-and-forget on our side.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Badge variant="default" className="shrink-0">
                  done
                </Badge>
                <span className="text-muted-foreground">
                  Clay called back with enrichment data. Final state.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Badge variant="destructive" className="shrink-0">
                  failed
                </Badge>
                <span className="text-muted-foreground">
                  Dead-letter queue. Either a permanent error, or we
                  exhausted the retry budget.
                </span>
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Retries &amp; backoff</h3>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>
                Up to <strong>5 attempts</strong> per job before it lands in{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  failed
                </code>
                .
              </li>
              <li>
                Backoff per attempt:{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  5s → 30s → 2m → 10m → 1h
                </code>
                , with ±20% jitter.
              </li>
              <li>
                <strong>429</strong> from Clay honors{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  Retry-After
                </code>{" "}
                AND opens a global rate-limit gate that pauses every
                dispatcher tick for that window.
              </li>
              <li>
                <strong>4xx</strong> and config errors are permanent — no
                retries, straight to failed.
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">
              Two flavors of failure (
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                last_error_code
              </code>
              )
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  callback_timeout
                </code>{" "}
                — dispatch POST succeeded but Clay never called back within
                15 min. The sweeper gave up after exhausting retries.
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  http_5xx
                </code>{" "}
                /{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  network
                </code>{" "}
                /{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  timeout
                </code>{" "}
                — dispatch kept failing transiently and exhausted all 5
                attempts.
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  http_4xx
                </code>{" "}
                /{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  config
                </code>{" "}
                — permanent error on the first try; we don't burn retries
                on something that can't succeed.
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  http_429
                </code>{" "}
                — rate-limited. Only marks failed if it persists through
                all attempts.
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">The buttons</h3>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>
                <strong>Enrich pending (N)</strong> — bumps every{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  queued
                </code>{" "}
                row's <em>next attempt</em> to now. Useful for rows sitting
                on a long backoff that you want to retry immediately.
              </li>
              <li>
                <strong>Retry failed (N)</strong> — resets every{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  failed
                </code>{" "}
                row back to{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  queued
                </code>{" "}
                with attempt_count=0 and errors cleared. The worker picks
                them up fresh.
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Row details</h3>
            <p className="text-xs text-muted-foreground">
              Click any row to expand: attempt count, next retry time, full
              error code/message, and the raw enrichment JSON. The ⚠ icon
              next to a status badge means there's a stored error message
              on that row.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Idempotency</h3>
            <p className="text-xs text-muted-foreground">
              Re-uploading the same CSV is safe — candidates are upserted
              by LinkedIn URL and job rows are left as-is. The worker's
              atomic claim (
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                UPDATE … FOR UPDATE SKIP LOCKED
              </code>
              ) prevents two ticks from dispatching the same row, and
              duplicate callbacks just overwrite the same enrichment data.
            </p>
          </section>
        </div>
      </dialog>
    </>
  );
}
