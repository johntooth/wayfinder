import { describe, expect, it } from "vitest";
import { ok, type NewAuditLog, type PendingSchemaRequest, type SessionMessage } from "@rbrasier/domain";
import { ResolveSchemaRequest } from "./resolve-schema-request";

const pendingRequest = (overrides: Partial<PendingSchemaRequest> = {}): PendingSchemaRequest => ({
  toolName: "request_schema_definition",
  prompt: "What should the supplier report capture?",
  proposedFields: [],
  status: "pending",
  ...overrides,
});

const message = (schemaRequest: PendingSchemaRequest | null): SessionMessage => ({
  id: "msg-1",
  sessionId: "sess-1",
  role: "system",
  content: "Define the report schema.",
  senderUserId: null,
  confidence: null,
  stepNodeId: "node-1",
  document: null,
  documentStatus: null,
  aiPayload: null,
  schemaRequest,
  createdAt: new Date(),
});

// Captures what the use case wrote, so a test can assert on the persisted
// request rather than on the call arguments.
const fakes = (stored: SessionMessage | null) => {
  const written: PendingSchemaRequest[] = [];
  const audited: NewAuditLog[] = [];
  const created: { content: string; role: string }[] = [];

  return {
    written,
    audited,
    created,
    messages: {
      findById: async () => ok(stored),
      updateSchemaRequest: async (_id: string, request: PendingSchemaRequest) => {
        written.push(request);
        return ok({ ...message(request) });
      },
      create: async (input: { content: string; role: string }) => {
        created.push({ content: input.content, role: input.role });
        return ok(message(null));
      },
    },
    auditLogger: {
      log: async (entry: NewAuditLog) => {
        audited.push(entry);
        return ok(undefined);
      },
    },
  };
};

const drafts = [
  {
    label: "Supplier Name",
    type: "text",
    required: true,
    options: [] as string[],
    min: null,
    max: null,
    instruction: "The legal entity on the contract.",
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const build = (f: ReturnType<typeof fakes>) => new ResolveSchemaRequest(f.messages as any, f.auditLogger as any);

describe("ResolveSchemaRequest — submit", () => {
  it("persists the validated fields and marks the request submitted", async () => {
    const f = fakes(message(pendingRequest()));

    const result = await build(f).submit({ messageId: "msg-1", userId: "user-1", fields: drafts });

    expect(result.error).toBeUndefined();
    expect(f.written).toHaveLength(1);
    expect(f.written[0]?.status).toBe("submitted");
    expect(f.written[0]?.fields?.[0]?.key).toBe("supplier_name");
    expect(f.written[0]?.resolvedByUserId).toBe("user-1");
    expect(f.written[0]?.resolvedAt).toBeTruthy();
  });

  it("audits the submission as workflow state, not just a chat message", async () => {
    const f = fakes(message(pendingRequest()));

    await build(f).submit({ messageId: "msg-1", userId: "user-1", fields: drafts });

    expect(f.audited).toHaveLength(1);
    expect(f.audited[0]?.action).toBe("session.schema_defined");
    expect(f.audited[0]?.actorId).toBe("user-1");
    expect(f.audited[0]?.resourceId).toBe("sess-1");
    expect(f.audited[0]?.metadata).toMatchObject({ fieldCount: 1, messageId: "msg-1" });
  });

  it("makes the schema readable by the next turn as a system message", async () => {
    const f = fakes(message(pendingRequest()));

    await build(f).submit({ messageId: "msg-1", userId: "user-1", fields: drafts });

    expect(f.created).toHaveLength(1);
    expect(f.created[0]?.content).toContain("Supplier Name");
  });

  it("refuses a message that carries no schema request", async () => {
    const f = fakes(message(null));

    const result = await build(f).submit({ messageId: "msg-1", userId: "user-1", fields: drafts });

    expect(result.error?.code).toBe("NOT_FOUND");
    expect(f.written).toHaveLength(0);
  });

  it("refuses a request that was already answered", async () => {
    const f = fakes(message(pendingRequest({ status: "submitted" })));

    const result = await build(f).submit({ messageId: "msg-1", userId: "user-1", fields: drafts });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(f.written).toHaveLength(0);
  });

  it("refuses an invalid field set without writing anything", async () => {
    const f = fakes(message(pendingRequest()));

    const result = await build(f).submit({
      messageId: "msg-1",
      userId: "user-1",
      fields: [{ ...drafts[0]!, type: "signature" }],
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("signature");
    expect(f.written).toHaveLength(0);
    expect(f.audited).toHaveLength(0);
  });

  it("refuses a missing message", async () => {
    const f = fakes(null);

    const result = await build(f).submit({ messageId: "msg-1", userId: "user-1", fields: drafts });

    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("ResolveSchemaRequest — dismiss", () => {
  it("marks the request dismissed and records no fields", async () => {
    const f = fakes(message(pendingRequest()));

    const result = await build(f).dismiss({ messageId: "msg-1", userId: "user-1" });

    expect(result.error).toBeUndefined();
    expect(f.written[0]?.status).toBe("dismissed");
    expect(f.written[0]?.fields).toBeUndefined();
  });

  it("leaves the operator a message to act on rather than a dead thread", async () => {
    const f = fakes(message(pendingRequest()));

    await build(f).dismiss({ messageId: "msg-1", userId: "user-1" });

    expect(f.created).toHaveLength(1);
    expect(f.created[0]?.content.toLowerCase()).toContain("still");
  });

  it("refuses a request that was already answered", async () => {
    const f = fakes(message(pendingRequest({ status: "dismissed" })));

    const result = await build(f).dismiss({ messageId: "msg-1", userId: "user-1" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(f.written).toHaveLength(0);
  });
});
