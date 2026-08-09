import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { approvalPatchToColumns, recordedSnapshotWhere } from "./drizzle-approval-repository";

const render = (statement: SQL | undefined) => new PgDialect().sqlToQuery(statement!);

describe("recordedSnapshotWhere", () => {
  it("counts only an approval that approved something", () => {
    const { sql, params } = render(recordedSnapshotWhere("sess-1"));
    const text = sql.toLowerCase();

    expect(text).toContain("session_id");
    expect(text).toContain("record_snapshot");
    expect(text).toContain("is not null");
    expect(text).toContain("status");
    expect(params).toContain("sess-1");
    expect(params).toContain("approved");
  });

  it("does not lock on a pending or changes-requested row", () => {
    // A pending row caches the resolved subject in the same column, and a change
    // request has to leave the document editable — that is the whole point of
    // the outcome.
    const { params } = render(recordedSnapshotWhere("sess-1"));

    expect(params).not.toContain("pending");
    expect(params).not.toContain("changes_requested");
  });
});

describe("approvalPatchToColumns", () => {
  it("writes the extended record whole into the existing jsonb column", () => {
    const record = {
      "manager_review.decision": "approved_with_edits",
      "manager_review.approver_name": "Jane Doe",
      "manager_review.approver_email": "jane.doe@example.com",
      "manager_review.decided_at": "2026-08-01T14:32:11.204Z",
      "manager_review.comment": "Within delegated authority.",
      "manager_review.edited_field_keys": ["commencement_date"],
      "manager_review.verification_code": "3F9A2C1E7B04",
      subjectDescription: 'the output of the step "Prepare instrument"',
      subjectNodeId: "node-draft",
      signatureFieldKey: "delegate_signature",
      attestationText: "Approved by:   Jane Doe",
      stepOutputs: [{ nodeId: "node-draft", fields: [] }],
    };

    const columns = approvalPatchToColumns({
      status: "approved_with_edits",
      recordSnapshot: record,
    });

    // No new column: everything rides `record_snapshot`, unflattened and
    // unfiltered, so extending the record shape never needs a migration.
    expect(columns.record_snapshot).toEqual(record);
    expect(columns.status).toBe("approved_with_edits");
    expect(Object.keys(columns)).toEqual(["status", "record_snapshot", "updated_at"]);
  });

  it("omits a field the patch did not mention, so a partial update stays partial", () => {
    const columns = approvalPatchToColumns({ comment: "Fix the date." });

    expect(columns).not.toHaveProperty("record_snapshot");
    expect(columns).not.toHaveProperty("status");
    expect(columns.comment).toBe("Fix the date.");
  });

  it("clears the record when the patch sets it to null", () => {
    const columns = approvalPatchToColumns({ recordSnapshot: null });

    expect(columns.record_snapshot).toBeNull();
  });

  it("maps the originator's request message to its own column", () => {
    const columns = approvalPatchToColumns({
      requestMessage: "Board meets Thursday — a signature before then would help.",
    });

    expect(columns.request_message).toContain("Board meets Thursday");
  });

  // The request note and the approver's decision comment share a row. A
  // decision must not carry the note away with it, which is why they are two
  // columns rather than one.
  it("leaves the request message untouched when a decision writes its comment", () => {
    const columns = approvalPatchToColumns({
      status: "approved",
      comment: "Within delegated authority.",
    });

    expect(columns).not.toHaveProperty("request_message");
  });

  it("records a withdrawal as a status with no decider", () => {
    const columns = approvalPatchToColumns({
      status: "withdrawn",
      decidedAt: new Date("2026-08-07T09:30:00.000Z"),
    });

    expect(columns.status).toBe("withdrawn");
    expect(columns).not.toHaveProperty("decided_by_user_id");
  });
});
