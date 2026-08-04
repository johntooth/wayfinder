import { describe, expect, it } from "vitest";
import { HelpMenu } from "./help-menu";

// The menu's contents are now admin-configured (see the about-links entity in
// @rbrasier/domain, which owns the URL/icon validation and the help-menu filter).
describe("HelpMenu", () => {
  it("exports a function component", () => {
    expect(typeof HelpMenu).toBe("function");
  });

  it("component name is HelpMenu", () => {
    expect(HelpMenu.name).toBe("HelpMenu");
  });
});
