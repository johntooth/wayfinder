import { describe, expect, it } from "vitest";
import { ReviewTable } from "./review-table";

describe("ReviewTable", () => {
  it("exports a function component", () => {
    expect(typeof ReviewTable).toBe("function");
  });

  it("component name is ReviewTable", () => {
    expect(ReviewTable.name).toBe("ReviewTable");
  });
});
