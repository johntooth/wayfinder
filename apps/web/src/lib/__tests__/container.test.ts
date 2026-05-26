import { afterEach, describe, expect, it } from "vitest";
import { getContainer } from "../container";

type GlobalWithContainer = typeof globalThis & {
  _wayfinder_container: unknown;
};

describe("getContainer", () => {
  afterEach(() => {
    (globalThis as GlobalWithContainer)._wayfinder_container = undefined;
  });

  it("returns the same instance on every call", () => {
    const sentinel = { isSingleton: true };
    (globalThis as GlobalWithContainer)._wayfinder_container = sentinel;

    const first = getContainer();
    const second = getContainer();

    expect(first).toBe(sentinel);
    expect(second).toBe(sentinel);
    expect(first).toBe(second);
  });

  it("stores the built container on globalThis", () => {
    const sentinel = { isSingleton: true };
    (globalThis as GlobalWithContainer)._wayfinder_container = sentinel;

    getContainer();

    expect((globalThis as GlobalWithContainer)._wayfinder_container).toBe(sentinel);
  });
});
