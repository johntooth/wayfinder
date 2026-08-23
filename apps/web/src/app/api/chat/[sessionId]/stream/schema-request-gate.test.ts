import { describe, expect, it } from "vitest";
import type { McpToolCallRecord } from "@rbrasier/domain";
import { buildPendingSchemaRequest, findSchemaRequestCall } from "./schema-request-gate";

const call = (toolName: string, args: unknown = {}): McpToolCallRecord => ({
  serverLabel: "redline",
  toolName,
  arguments: JSON.stringify(args),
  result: "",
  calledAt: new Date().toISOString(),
});

describe("findSchemaRequestCall", () => {
  it("finds the call the node names", () => {
    const found = findSchemaRequestCall(
      [call("search_documents"), call("request_schema_definition")],
      "request_schema_definition",
    );

    expect(found?.toolName).toBe("request_schema_definition");
  });

  it("returns null when the node names no schema-request tool", () => {
    expect(findSchemaRequestCall([call("request_schema_definition")], undefined)).toBeNull();
  });

  it("returns null when the node names a blank tool", () => {
    expect(findSchemaRequestCall([call("request_schema_definition")], "   ")).toBeNull();
  });

  it("returns null when no call matches", () => {
    expect(findSchemaRequestCall([call("search_documents")], "request_schema_definition")).toBeNull();
  });

  it("suspends on the first match when the model called it twice", () => {
    const found = findSchemaRequestCall(
      [call("define_schema", { prompt: "first" }), call("define_schema", { prompt: "second" })],
      "define_schema",
    );

    expect(found?.arguments).toContain("first");
  });
});

describe("buildPendingSchemaRequest", () => {
  it("starts pending, with no fields recorded yet", () => {
    const request = buildPendingSchemaRequest(call("define_schema"));

    expect(request.status).toBe("pending");
    expect(request.fields).toBeUndefined();
    expect(request.toolName).toBe("define_schema");
  });

  it("takes the prompt from the tool arguments", () => {
    const request = buildPendingSchemaRequest(
      call("define_schema", { prompt: "What should the supplier report capture?" }),
    );

    expect(request.prompt).toBe("What should the supplier report capture?");
  });

  it("falls back to a default prompt when the model supplied none", () => {
    expect(buildPendingSchemaRequest(call("define_schema")).prompt.length).toBeGreaterThan(0);
  });

  it("seeds the form from the fields the model proposed", () => {
    const request = buildPendingSchemaRequest(
      call("define_schema", { fields: [{ label: "Supplier Name", type: "text" }] }),
    );

    expect(request.proposedFields).toHaveLength(1);
    expect(request.proposedFields[0]?.label).toBe("Supplier Name");
  });

  it("still yields a usable form when the arguments are unparseable", () => {
    const request = buildPendingSchemaRequest({
      serverLabel: "redline",
      toolName: "define_schema",
      arguments: "not json",
      result: "",
      calledAt: new Date().toISOString(),
    });

    expect(request.proposedFields).toHaveLength(1);
    expect(request.status).toBe("pending");
  });
});
