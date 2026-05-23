"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import { useState, type PropsWithChildren } from "react";
import superjson from "superjson";
import { createQueryClient } from "@/lib/query-client";
import { trpc } from "./client";

export const TrpcProvider = ({ children }: PropsWithChildren) => {
  const [queryClient] = useState(() => createQueryClient());

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchStreamLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
};
