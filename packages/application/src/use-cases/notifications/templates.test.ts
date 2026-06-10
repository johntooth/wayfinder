import { describe, expect, it } from "vitest";
import { buildFlowSharedEmail, buildSessionCompleteEmail } from "./templates";

describe("buildSessionCompleteEmail", () => {
  it("names the flow in the subject and links to the session", () => {
    const email = buildSessionCompleteEmail({
      flowName: "Procurement Plan",
      sessionTitle: "Q3 laptops",
      sessionUrl: "https://wayfinder.example/chats/session-1",
    });

    expect(email.subject).toBe("Your 'Procurement Plan' session is complete");
    expect(email.text).toContain("Q3 laptops");
    expect(email.text).toContain("https://wayfinder.example/chats/session-1");
    expect(email.html).toContain('href="https://wayfinder.example/chats/session-1"');
  });

  it("falls back to the flow name when the session has no title", () => {
    const email = buildSessionCompleteEmail({
      flowName: "Procurement Plan",
      sessionTitle: null,
      sessionUrl: "https://wayfinder.example/chats/session-1",
    });

    expect(email.text).toContain("Procurement Plan");
  });

  it("escapes HTML in user-controlled names", () => {
    const email = buildSessionCompleteEmail({
      flowName: "<script>alert(1)</script>",
      sessionTitle: "a & b",
      sessionUrl: "https://wayfinder.example/chats/session-1",
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("a &amp; b");
  });
});

describe("buildFlowSharedEmail", () => {
  it("names the granter, flow, and role, and links to the flow", () => {
    const email = buildFlowSharedEmail({
      flowName: "Procurement Plan",
      granterName: "Alice",
      role: "owner",
      flowUrl: "https://wayfinder.example/admin/flows/flow-1",
    });

    expect(email.subject).toBe("Alice shared the 'Procurement Plan' flow with you");
    expect(email.text).toContain("owner");
    expect(email.text).toContain("https://wayfinder.example/admin/flows/flow-1");
    expect(email.html).toContain('href="https://wayfinder.example/admin/flows/flow-1"');
  });

  it("uses a neutral granter name when none is known", () => {
    const email = buildFlowSharedEmail({
      flowName: "Procurement Plan",
      granterName: null,
      role: "viewer",
      flowUrl: "https://wayfinder.example/admin/flows/flow-1",
    });

    expect(email.subject).toBe("Someone shared the 'Procurement Plan' flow with you");
  });

  it("escapes HTML in user-controlled names", () => {
    const email = buildFlowSharedEmail({
      flowName: "Plan <b>",
      granterName: "Eve & co",
      role: "viewer",
      flowUrl: "https://wayfinder.example/admin/flows/flow-1",
    });

    expect(email.html).toContain("Plan &lt;b&gt;");
    expect(email.html).toContain("Eve &amp; co");
  });
});
