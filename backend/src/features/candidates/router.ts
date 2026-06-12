import { z } from "zod";
import { router, publicProcedure } from "../../trpc/trpc.js";
import * as service from "./service.js";

export const candidatesRouter = router({
  list: publicProcedure.query(({ ctx }) => service.list(ctx)),

  ingestCsv: publicProcedure
    .input(z.object({ csvText: z.string().min(1).max(1_000_000) }))
    .mutation(({ ctx, input }) => service.ingestCsv(ctx, input)),
});
