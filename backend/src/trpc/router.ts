import { router } from "./trpc.js";
import { candidatesRouter } from "../features/candidates/router.js";

export const appRouter = router({
  candidates: candidatesRouter,
});

export type AppRouter = typeof appRouter;
