import { z } from "zod";
import { router, publicProcedure } from "../../trpc/trpc.js";
import * as service from "./service.js";

export const exampleRouter = router({
  list: publicProcedure.query(({ ctx }) => service.list(ctx)),

  create: publicProcedure
    .input(z.object({ name: z.string().min(1).max(200) }))
    .mutation(({ ctx, input }) => service.create(ctx, input)),

  hello: publicProcedure
    .input(z.object({ name: z.string().optional() }).optional())
    .query(({ input }) => ({
      greeting: `Hello, ${input?.name ?? "world"}!`,
    })),
});
