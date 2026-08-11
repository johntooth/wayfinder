import { getContainer } from "../src/lib/container";
import { seedRedlineMcpServer } from "../src/lib/redline-seed-mcp-server";

// The report-server registration driver. Registers
// apps/redline-mcp in Wayfinder over streamable HTTP, internal-only, so a UAT
// bring-up is scripted rather than an admin click. Mirrors
// seed-redline-evaluation.ts, but the MCP use cases live on the served
// container's `useCases` seam (RegisterMcpServer / ListMcpServers are admin
// surfaces), so it reads them straight off the container.
//
// Idempotent: the seed function guards create with a list-then-create match on
// URL, so re-running against an already-registered stack is a no-op.
//
// Exits explicitly. getContainer() builds the whole Wayfinder graph, whose
// Postgres pools (the app pool and the LISTEN/NOTIFY connection) hold the event
// loop open with nothing to close them — a bare `await main()` would print and
// then hang, which is the opposite of a scriptable bring-up step.
//
// Usage: pnpm --filter @wayfinder/web exec tsx scripts/seed-redline-mcp-server.ts

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const main = async (): Promise<void> => {
  const container = getContainer();

  const seeded = await seedRedlineMcpServer({
    registerMcpServer: container.useCases.registerMcpServer,
    listMcpServers: container.useCases.listMcpServers,
  });
  if (seeded.error) {
    fail(`registering the report server failed: ${seeded.error.message}`);
    return;
  }

  const action = seeded.data.created ? "registered" : "already registered";
  process.stdout.write(
    `report server ${action}: ${seeded.data.server.label} (${seeded.data.server.transport}) ` +
      `at ${seeded.data.server.url} — id ${seeded.data.server.id}\n`,
  );
  process.exit(0);
};

await main();
