import { domainError, err, ok } from "@rbrasier/domain";
import type {
  IMcpServerDirectory,
  IMcpClient,
  IMcpServerRepository,
  ListMcpServersInput,
  McpServer,
  McpServerStatus,
  McpServerUpdate,
  McpServerWithTools,
  McpTool,
  McpToolCallOutput,
  NewMcpServer,
  Result,
} from "@rbrasier/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DisableMcpServer,
  EnableMcpServer,
  ListMcpServers,
  ListSelectableContextMcpServers,
  RegisterMcpServer,
  ResolveStepTools,
  TestMcpServer,
  UpdateMcpServer,
} from "./mcp";

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
      kind: input.kind ?? "context",
      businessSelectable: input.businessSelectable ?? false,
      url: input.url,
      credentialRef: input.credentialRef ?? null,
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
    const current = this.rows[index]!;
    const updated: McpServer = {
      ...current,
      label: patch.label ?? current.label,
      kind: patch.kind ?? current.kind,
      businessSelectable: patch.businessSelectable ?? current.businessSelectable,
      url: patch.url ?? current.url,
      credentialRef:
        patch.credentialRef === undefined ? current.credentialRef : patch.credentialRef,
    };
    this.rows[index] = updated;
    return ok(updated);
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
}

const stubTools: McpTool[] = [
  { name: "search", description: "Search the web", inputSchema: null },
  { name: "fetch", description: null, inputSchema: null },
];

const okClient: IMcpClient = {
  async listTools(): Promise<Result<McpTool[]>> {
    return ok(stubTools);
  },
  async callTool(): Promise<Result<McpToolCallOutput>> {
    return ok({ output: "done" });
  },
};

const failingClient: IMcpClient = {
  async listTools(): Promise<Result<McpTool[]>> {
    return err(domainError("INFRA_FAILURE", "unreachable"));
  },
  async callTool(): Promise<Result<McpToolCallOutput>> {
    return err(domainError("INFRA_FAILURE", "unreachable"));
  },
};

describe("RegisterMcpServer", () => {
  let repository: InMemoryMcpServerRepository;

  beforeEach(() => {
    repository = new InMemoryMcpServerRepository();
  });

  it("creates a server with a trimmed label and url", async () => {
    const result = await new RegisterMcpServer(repository).execute({
      label: "  GitHub  ",
      url: "https://mcp.example.com/sse",
    });
    expect(result.data?.label).toBe("GitHub");
    expect(result.data?.status).toBe("active");
  });

  it("rejects an empty label", async () => {
    const result = await new RegisterMcpServer(repository).execute({ label: "  ", url: "https://x.y" });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a non-http url", async () => {
    const result = await new RegisterMcpServer(repository).execute({
      label: "Bad",
      url: "ftp://nope",
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("defaults transport to sse and records an explicit streamable-http", async () => {
    const sseDefault = await new RegisterMcpServer(repository).execute({
      label: "Default",
      url: "https://a.example/sse",
    });
    expect(sseDefault.data?.transport).toBe("sse");

    const streamable = await new RegisterMcpServer(repository).execute({
      label: "Streamable",
      url: "https://b.example/mcp",
      transport: "streamable-http",
    });
    expect(streamable.data?.transport).toBe("streamable-http");
  });

  it("defaults businessSelectable to false and records it when set", async () => {
    const closed = await new RegisterMcpServer(repository).execute({
      label: "Closed",
      url: "https://a.example/sse",
    });
    expect(closed.data?.businessSelectable).toBe(false);

    const open = await new RegisterMcpServer(repository).execute({
      label: "Open",
      url: "https://b.example/sse",
      businessSelectable: true,
    });
    expect(open.data?.businessSelectable).toBe(true);
  });
});

describe("UpdateMcpServer", () => {
  it("rejects an invalid url on update", async () => {
    const repository = new InMemoryMcpServerRepository();
    const created = await new RegisterMcpServer(repository).execute({
      label: "X",
      url: "https://x.y",
    });
    const result = await new UpdateMcpServer(repository).execute({
      id: created.data!.id,
      url: "not-a-url",
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("updates the label and url when valid", async () => {
    const repository = new InMemoryMcpServerRepository();
    const created = await new RegisterMcpServer(repository).execute({
      label: "Old",
      url: "https://old.example/sse",
    });
    const result = await new UpdateMcpServer(repository).execute({
      id: created.data!.id,
      label: "New",
      url: "https://new.example/sse",
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.label).toBe("New");
    expect(result.data?.url).toBe("https://new.example/sse");
  });

  it("toggles businessSelectable without touching other fields", async () => {
    const repository = new InMemoryMcpServerRepository();
    const created = await new RegisterMcpServer(repository).execute({
      label: "S",
      url: "https://s.example/sse",
    });
    const result = await new UpdateMcpServer(repository).execute({
      id: created.data!.id,
      businessSelectable: true,
    });
    expect(result.data?.businessSelectable).toBe(true);
    expect(result.data?.label).toBe("S");
  });
});

describe("Disable / Enable / List", () => {
  it("excludes disabled servers by default and includes them on request", async () => {
    const repository = new InMemoryMcpServerRepository();
    const register = new RegisterMcpServer(repository);
    const first = await register.execute({ label: "A", url: "https://a.example/sse" });
    await register.execute({ label: "B", url: "https://b.example/sse" });

    await new DisableMcpServer(repository).execute(first.data!.id);

    const active = await new ListMcpServers(repository).execute();
    expect(active.data).toHaveLength(1);

    const all = await new ListMcpServers(repository).execute({ includeDisabled: true });
    expect(all.data).toHaveLength(2);

    await new EnableMcpServer(repository).execute(first.data!.id);
    const reactivated = await new ListMcpServers(repository).execute();
    expect(reactivated.data).toHaveLength(2);
  });
});

describe("TestMcpServer", () => {
  let repository: InMemoryMcpServerRepository;

  beforeEach(() => {
    repository = new InMemoryMcpServerRepository();
  });

  it("returns the discovered tool count for a reachable server", async () => {
    const created = await new RegisterMcpServer(repository).execute({
      label: "X",
      url: "https://x.example/sse",
    });
    const result = await new TestMcpServer(repository, okClient).execute(created.data!.id);
    expect(result.data?.toolCount).toBe(2);
    expect(result.data?.tools[0]?.name).toBe("search");
  });

  it("propagates a client failure as an error", async () => {
    const created = await new RegisterMcpServer(repository).execute({
      label: "X",
      url: "https://x.example/sse",
    });
    const result = await new TestMcpServer(repository, failingClient).execute(created.data!.id);
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("returns NOT_FOUND for an unknown server", async () => {
    const result = await new TestMcpServer(repository, okClient).execute("missing");
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("ResolveStepTools", () => {
  it("returns empty when the step allows no tools", async () => {
    const repository = new InMemoryMcpServerRepository();
    const result = await new ResolveStepTools(repository).execute(undefined);
    expect(result.data).toEqual({ refs: [], servers: [] });
  });

  it("keeps allowed tools on active servers and dedupes the server list", async () => {
    const repository = new InMemoryMcpServerRepository();
    const server = await new RegisterMcpServer(repository).execute({
      label: "S",
      url: "https://s.example/sse",
    });
    const id = server.data!.id;

    const result = await new ResolveStepTools(repository).execute([
      { serverId: id, toolName: "search" },
      { serverId: id, toolName: "fetch" },
    ]);

    expect(result.data?.refs).toHaveLength(2);
    expect(result.data?.servers).toHaveLength(1);
  });

  it("drops refs to a disabled server (deny-by-default)", async () => {
    const repository = new InMemoryMcpServerRepository();
    const server = await new RegisterMcpServer(repository).execute({
      label: "S",
      url: "https://s.example/sse",
    });
    const id = server.data!.id;
    await new DisableMcpServer(repository).execute(id);

    const result = await new ResolveStepTools(repository).execute([
      { serverId: id, toolName: "search" },
    ]);

    expect(result.data?.refs).toEqual([]);
    expect(result.data?.servers).toEqual([]);
  });

  it("propagates a repository error", async () => {
    const repository = {
      list: async () => err(domainError("INFRA_FAILURE", "db down")),
    } as unknown as IMcpServerRepository;
    const result = await new ResolveStepTools(repository).execute([
      { serverId: "x", toolName: "search" },
    ]);
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

describe("ListSelectableContextMcpServers", () => {
  const entry = (overrides: Partial<McpServer>): McpServerWithTools => ({
    server: {
      id: "s",
      label: "S",
      transport: "sse",
      kind: "context",
      businessSelectable: false,
      url: "https://mcp.example.com/sse",
      credentialRef: null,
      status: "active",
      createdByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    },
    tools: [],
  });

  const directoryOf = (entries: McpServerWithTools[]): IMcpServerDirectory => ({
    listServersWithTools: async () => ok(entries),
  });

  const entries = [
    entry({ id: "ctx-open", kind: "context", businessSelectable: true }),
    entry({ id: "ctx-closed", kind: "context", businessSelectable: false }),
    entry({ id: "actions-open", kind: "actions", businessSelectable: true }),
  ];

  it("returns all context servers when the caller may select all", async () => {
    const result = await new ListSelectableContextMcpServers(directoryOf(entries)).execute(true);
    expect(result.data?.map((item) => item.server.id)).toEqual(["ctx-open", "ctx-closed"]);
  });

  it("returns only business-selectable context servers otherwise", async () => {
    const result = await new ListSelectableContextMcpServers(directoryOf(entries)).execute(false);
    expect(result.data?.map((item) => item.server.id)).toEqual(["ctx-open"]);
  });

  it("never returns an actions server, even one marked selectable", async () => {
    const result = await new ListSelectableContextMcpServers(directoryOf(entries)).execute(false);
    expect(result.data?.some((item) => item.server.kind === "actions")).toBe(false);
  });

  it("propagates a directory error", async () => {
    const failing: IMcpServerDirectory = {
      listServersWithTools: async () => err(domainError("INFRA_FAILURE", "unreachable")),
    };
    const result = await new ListSelectableContextMcpServers(failing).execute(true);
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
