import { QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import superjson from "superjson";

const retryFn = (failureCount: number, error: unknown): boolean => {
  if (error instanceof TRPCClientError) {
    const status = error.data?.httpStatus as number | undefined;
    if (status !== undefined && status >= 400 && status < 500) return false;
  }
  return failureCount < 3;
};

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: retryFn,
      },
      dehydrate: { serializeData: superjson.serialize },
      hydrate: { deserializeData: superjson.deserialize },
    },
  });
