import { z } from "zod";
import { router, publicProcedure } from "../../trpc/trpc.js";
import * as service from "./service.js";

export const jobsRouter = router({
  list: publicProcedure.query(({ ctx }) => service.list(ctx)),

  get: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => service.get(ctx, input)),

  ingest: publicProcedure
    .input(
      z.object({
        title: z.string().max(200).optional().nullable(),
        descriptionText: z.string().min(20).max(50_000),
      }),
    )
    .mutation(({ ctx, input }) => service.ingestJobDescription(ctx, input)),

  remove: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => service.remove(ctx, input)),

  matches: publicProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => service.findMatchesForJob(ctx, input)),
});
