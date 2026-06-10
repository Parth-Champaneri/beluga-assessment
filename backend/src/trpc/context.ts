import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { db } from "../db/index.js";

export function createContext(_opts: CreateExpressContextOptions) {
  return {
    db,
  };
}

export type Context = ReturnType<typeof createContext>;
