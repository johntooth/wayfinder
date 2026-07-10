import { domainError, err, ok } from "@rbrasier/domain";
import type {
  IMcpClient,
  IMcpServerDirectory,
  IMcpServerRepository,
  ListMcpServersInput,
  McpServer,
  McpServerWithTools,
  McpTool,
  Result,
} from "@rbrasier/domain";

export class RegisterMcpServer {
  constructor(private readonly servers: IMcpServerRepository) {}

  async execute(input: {
    label: string;
    url: string;
    credentialRef?: string | null;
    createdByUserId?: string | null;
  }): Promise<Result<McpServer>> {
    const label = input.label.trim();
    const url = input.url.trim();
    if (label.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Server label is required."));
    }
    if (!isHttpUrl(url)) {
      return err(domainError("VALIDATION_FAILED", "Server URL must be a valid http(s) URL."));
    }
    return this.servers.create({
      label,
      url,
      credentialRef: input.credentialRef?.trim() ? input.credentialRef.trim() : null,
      createdByUserId: input.createdByUserId ?? null,
    });
  }
}

export class UpdateMcpServer {
  constructor(private readonly servers: IMcpServerRepository) {}

  async execute(input: {
    id: string;
    label?: string;
    url?: string;
    credentialRef?: string | null;
  }): Promise<Result<McpServer>> {
    if (input.url !== undefined && !isHttpUrl(input.url.trim())) {
      return err(domainError("VALIDATION_FAILED", "Server URL must be a valid http(s) URL."));
    }
    return this.servers.update(input.id, {
      label: input.label?.trim(),
      url: input.url?.trim(),
      credentialRef:
        input.credentialRef === undefined
          ? undefined
          : input.credentialRef?.trim()
            ? input.credentialRef.trim()
            : null,
    });
  }
}

export class ListMcpServers {
  constructor(private readonly servers: IMcpServerRepository) {}

  async execute(input?: ListMcpServersInput): Promise<Result<McpServer[]>> {
    return this.servers.list(input);
  }
}

export class DisableMcpServer {
  constructor(private readonly servers: IMcpServerRepository) {}

  async execute(id: string): Promise<Result<McpServer>> {
    return this.servers.setStatus(id, "disabled");
  }
}

export class EnableMcpServer {
  constructor(private readonly servers: IMcpServerRepository) {}

  async execute(id: string): Promise<Result<McpServer>> {
    return this.servers.setStatus(id, "active");
  }
}

export interface TestMcpServerOutput {
  readonly toolCount: number;
  readonly tools: McpTool[];
}

// Connection test: resolves the server and lists its tools. Surfaces a typed
// error rather than throwing so the admin UI can show why a server is unreachable.
export class TestMcpServer {
  constructor(
    private readonly servers: IMcpServerRepository,
    private readonly client: IMcpClient,
  ) {}

  async execute(id: string): Promise<Result<TestMcpServerOutput>> {
    const found = await this.servers.findById(id);
    if (found.error) return err(found.error);
    if (!found.data) return err(domainError("NOT_FOUND", "MCP server not found."));

    const tools = await this.client.listTools(found.data);
    if (tools.error) return err(tools.error);
    return ok({ toolCount: tools.data.length, tools: tools.data });
  }
}

export class ListMcpServersWithTools {
  constructor(private readonly directory: IMcpServerDirectory) {}

  async execute(): Promise<Result<McpServerWithTools[]>> {
    return this.directory.listServersWithTools();
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
