import "server-only";
import { createHydrationHelpers } from "@trpc/react-query/rsc";
import { cache } from "react";
import { createQueryClient } from "@/lib/query-client";
import { appRouter, type AppRouter } from "@/server/router";
import { createCallerFactory } from "@/server/trpc";
import { createServerTrpcContext } from "@/server/server-context";

export const getQueryClient = cache(createQueryClient);

const createCaller = createCallerFactory(appRouter);

export const createServerHelpers = async () => {
  const context = await createServerTrpcContext();
  const caller = createCaller(context);
  return createHydrationHelpers<AppRouter>(caller, getQueryClient);
};
