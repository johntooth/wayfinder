import { describe, expect, it } from "vitest";
import { CANVAS_FIT_VIEW_OPTIONS } from "./rf-adapters";

describe("CANVAS_FIT_VIEW_OPTIONS", () => {
  it("caps fit-to-view at 1x so a single step is not magnified", () => {
    expect(CANVAS_FIT_VIEW_OPTIONS.maxZoom).toBe(1);
  });

  it("leaves breathing room around the fitted steps", () => {
    expect(CANVAS_FIT_VIEW_OPTIONS.padding).toBe(0.2);
  });
});
