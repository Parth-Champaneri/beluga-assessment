import { z } from "zod";
import { router, publicProcedure } from "../../trpc/trpc.js";
import * as service from "./service.js";

export const candidatesRouter = router({
  list: publicProcedure.query(({ ctx }) => service.list(ctx)),

  ingestCsv: publicProcedure
    .input(z.object({ csvText: z.string().min(1).max(1_000_000) }))
    .mutation(({ ctx, input }) => service.ingestCsv(ctx, input)),

  nudgeQueued: publicProcedure.mutation(({ ctx }) => service.nudgeQueued(ctx)),

  // Passthrough alias for the slice-1 UI binding. Kept for one release.
  enrichAll: publicProcedure.mutation(({ ctx }) => service.nudgeQueued(ctx)),

  retryFailed: publicProcedure.mutation(({ ctx }) => service.retryFailed(ctx)),
});
