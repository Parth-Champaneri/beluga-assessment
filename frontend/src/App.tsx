import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

function App() {
  const hello = useQuery(trpc.example.hello.queryOptions({ name: "Beluga" }));

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-6 p-8 max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight">
          Beluga Assessment
        </h1>
        <p className="text-muted-foreground text-center">
          Vite + React + Tailwind v4 + Shadcn + tRPC + TanStack Query.
        </p>
        <div className="rounded-md border p-4 w-full">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            tRPC ping
          </div>
          <div className="font-mono text-sm">
            {hello.isLoading
              ? "loading…"
              : hello.error
                ? `error: ${hello.error.message}`
                : hello.data?.greeting}
          </div>
        </div>
        <Button onClick={() => hello.refetch()}>Refetch</Button>
      </div>
    </div>
  );
}

export default App;
