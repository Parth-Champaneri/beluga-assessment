import { CsvUpload } from "@/components/csv-upload";
import { CandidatesTable } from "@/components/candidates-table";
import { JobDescriptionRanker } from "@/components/job-description-ranker";

function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">
            Beluga Assessment
          </h1>
          <p className="text-sm text-muted-foreground">
            Upload a CSV of candidates, enrich them via Clay, rank against a JD.
          </p>
        </header>
        <CsvUpload />
        <JobDescriptionRanker />
        <CandidatesTable />
      </div>
    </div>
  );
}

export default App;
