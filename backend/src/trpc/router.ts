import { router } from "./trpc.js";
import { exampleRouter } from "../features/example/router.js";

export const appRouter = router({
  example: exampleRouter,
});

export type AppRouter = typeof appRouter;
