import { router } from "./trpc.js";
import { candidatesRouter } from "../features/candidates/router.js";
import { jobsRouter } from "../features/jobs/router.js";

export const appRouter = router({
  candidates: candidatesRouter,
  jobs: jobsRouter,
});

export type AppRouter = typeof appRouter;
