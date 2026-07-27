export async function register() {
  // Next.js compiles this file for the edge runtime as well as node. An early
  // `return` does not stop webpack from following the dynamic imports below, but
  // an `if` block does: NEXT_RUNTIME is inlined at build time, so in the edge
  // compilation this folds to `if (false)` and the imports — which reach node-only
  // modules such as @grpc/grpc-js — are eliminated instead of failing to resolve.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV === "production") {
      // Lazy import to keep the container out of the development bundle too.
      const { getContainer } = await import("@/lib/container");

      const persist = (err: unknown, source: string) => {
        try {
          const error = err instanceof Error ? err : new Error(String(err));
          const container = getContainer();
          void container.services.errorLogger.log({
            level: "fatal",
            message: error.message,
            stack: error.stack ?? null,
            page: `process:${source}`,
            metadata: { source },
          });
        } catch {
          // Logging must never re-throw inside an uncaughtException handler
        }
      };

      process.on("uncaughtException", (error) => persist(error, "uncaughtException"));
      process.on("unhandledRejection", (reason) => persist(reason, "unhandledRejection"));
    }

    // First-run setup link (ADR-041 §5). Emitted at app startup so it appears
    // under every launch method (pnpm dev, pnpm start, node, containers).
    //
    // Detached, and routed through a container-free module: Next.js awaits
    // register() before the server takes requests, so anything heavy here delays
    // the app's first response.
    void (async () => {
      try {
        const { emitSetupLink } = await import("@/lib/setup-link");
        await emitSetupLink();
      } catch {
        // The DB may not be migrated yet on the very first boot; the link is
        // emitted on the next start. Never block or crash startup on it.
      }
    })();
  }
}
