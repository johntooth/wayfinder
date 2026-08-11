import { domainError, err, ok } from "@rbrasier/domain";
import type {
  IMcpServerRepository,
  ListMcpServersInput,
  McpServer,
  McpServerStatus,
  McpServerUpdate,
  NewMcpServer,
  Result,
} from "@rbrasier/domain";
import { ListMcpServers, RegisterMcpServer } from "@rbrasier/application";
import { describe, expect, it } from "vitest";
import {
  REDLINE_MCP_SERVER_LABEL,
  REDLINE_MCP_SERVER_URL,
  seedRedlineMcpServer,
} from "./redline-seed-mcp-server";

// The exit test for the report server's registration:
// a list-then-create guard turns the RegisterMcpServer use case — which always
// creates — into an idempotent seed. Registered as streamable-http with
// communicatesExternally FALSE, or the assembler cannot select it in a flow
// (invariant 7).

class InMemoryMcpServerRepository implements IMcpServerRepository {
  rows: McpServer[] = [];
  private sequence = 0;

  async create(input: NewMcpServer): Promise<Result<McpServer>> {
    this.sequence += 1;
    const now = new Date();
    const server: McpServer = {
      id: `mcp-${this.sequence}`,
      label: input.label,
      transport: input.transport ?? "sse",
      url: input.url,
      credentialRef: input.credentialRef ?? null,
      communicatesExternally: input.communicatesExternally ?? false,
      status: "active",
      createdByUserId: input.createdByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(server);
    return ok(server);
  }

  async update(id: string, patch: McpServerUpdate): Promise<Result<McpServer>> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return err(domainError("NOT_FOUND", "MCP server not found."));
    this.rows[index] = { ...this.rows[index]!, ...patch };
    return ok(this.rows[index]!);
  }

  async findById(id: string): Promise<Result<McpServer | null>> {
    return ok(this.rows.find((row) => row.id === id) ?? null);
  }

  async list(input?: ListMcpServersInput): Promise<Result<McpServer[]>> {
    return ok(
      input?.includeDisabled ? this.rows : this.rows.filter((row) => row.status === "active"),
    );
  }

  async setStatus(id: string, status: McpServerStatus): Promise<Result<McpServer>> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return err(domainError("NOT_FOUND", "MCP server not found."));
    this.rows[index] = { ...this.rows[index]!, status };
    return ok(this.rows[index]!);
  }

  async delete(id: string): Promise<Result<void>> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return err(domainError("NOT_FOUND", "MCP server not found."));
    this.rows.splice(index, 1);
    return ok(undefined);
  }
}

const dependencies = (repository: IMcpServerRepository) => ({
  registerMcpServer: new RegisterMcpServer(repository),
  listMcpServers: new ListMcpServers(repository),
});

describe("seedRedlineMcpServer — the report server registration", () => {
  it("registers the report server as streamable-http, internal-only", async () => {
    const repository = new InMemoryMcpServerRepository();

    const seeded = await seedRedlineMcpServer(dependencies(repository));

    expect(seeded.error).toBeUndefined();
    expect(seeded.data?.created).toBe(true);
    const server = repository.rows[0];
    expect(server?.label).toBe(REDLINE_MCP_SERVER_LABEL);
    expect(server?.url).toBe(REDLINE_MCP_SERVER_URL);
    expect(server?.transport).toBe("streamable-http");
    expect(server?.communicatesExternally).toBe(false);
  });

  it("is idempotent: a second seed does not create a duplicate", async () => {
    const repository = new InMemoryMcpServerRepository();

    await seedRedlineMcpServer(dependencies(repository));
    const reseeded = await seedRedlineMcpServer(dependencies(repository));

    expect(reseeded.error).toBeUndefined();
    expect(reseeded.data?.created).toBe(false);
    expect(repository.rows).toHaveLength(1);
  });

  it("matches an existing server by url, including a disabled one", async () => {
    const repository = new InMemoryMcpServerRepository();
    await seedRedlineMcpServer(dependencies(repository));
    await repository.setStatus(repository.rows[0]!.id, "disabled");

    const reseeded = await seedRedlineMcpServer(dependencies(repository));

    expect(reseeded.data?.created).toBe(false);
    expect(repository.rows).toHaveLength(1);
  });

  it("propagates a list failure rather than creating blind", async () => {
    const failingList = {
      execute: async () => err(domainError("INFRA_FAILURE", "no database")),
    };
    const create = { execute: async () => ok({} as McpServer) };

    const seeded = await seedRedlineMcpServer({
      registerMcpServer: create as unknown as RegisterMcpServer,
      listMcpServers: failingList as unknown as ListMcpServers,
    });

    expect(seeded.error?.code).toBe("INFRA_FAILURE");
  });
});
