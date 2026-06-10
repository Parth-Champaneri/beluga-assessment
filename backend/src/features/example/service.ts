import type { Context } from "../../trpc/context.js";
import * as repo from "./repo.js";

export async function list(ctx: Context) {
  return repo.listExamples(ctx.db);
}

export async function create(ctx: Context, input: { name: string }) {
  return repo.createExample(ctx.db, { name: input.name });
}
