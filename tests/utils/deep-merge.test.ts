import { describe, expect, it } from "vitest";
import { deepMerge } from "../../src/utils/deep-merge.ts";

describe("deepMerge", () => {
  it("returns a copy of base when override is empty", () => {
    const base = { a: 1, b: { c: 2 } };
    const result = deepMerge(base, {});
    expect(result).toEqual({ a: 1, b: { c: 2 } });
    // Must be a new object, not the same reference
    expect(result).not.toBe(base);
    expect(result.b).not.toBe(base.b);
  });

  it("overrides scalar values", () => {
    const base = { a: 1, b: "hello" };
    const override = { a: 42 };
    expect(deepMerge(base, override)).toEqual({ a: 42, b: "hello" });
  });

  it("merges nested objects recursively", () => {
    const base = {
      providers: {
        brave: { enabled: true, monthlyQuota: 2000 },
        exa: { enabled: true, monthlyQuota: 1000 },
      },
    };
    const override = {
      providers: {
        brave: { enabled: false },
      },
    };
    const result = deepMerge(base, override);
    expect(result).toEqual({
      providers: {
        brave: { enabled: false, monthlyQuota: 2000 },
        exa: { enabled: true, monthlyQuota: 1000 },
      },
    });
  });

  it("replaces arrays entirely from override", () => {
    const base = { tags: ["a", "b", "c"] };
    const override = { tags: ["x"] };
    expect(deepMerge(base, override)).toEqual({ tags: ["x"] });
  });

  it("adds keys from override that are not in base", () => {
    const base = { a: 1 };
    const override = { b: 2 };
    expect(deepMerge(base, override)).toEqual({ a: 1, b: 2 });
  });

  it("handles null in override by replacing the value", () => {
    const base = { a: { nested: true } };
    const override = { a: null };
    expect(deepMerge(base, override)).toEqual({ a: null });
  });

  it("skips undefined values in override", () => {
    const base = { a: 1, b: 2 };
    const override = { a: undefined };
    expect(deepMerge(base, override)).toEqual({ a: 1, b: 2 });
  });

  it("does not merge when override value is not a plain object", () => {
    const base = { a: { nested: true } };
    const override = { a: "replaced" };
    expect(deepMerge(base, override)).toEqual({ a: "replaced" });
  });

  it("does not merge when base value is not a plain object", () => {
    const base = { a: "string" };
    const override = { a: { nested: true } };
    expect(deepMerge(base, override)).toEqual({ a: { nested: true } });
  });

  it("handles deeply nested structures (3+ levels)", () => {
    const base = { l1: { l2: { l3: { value: "base" } } } };
    const override = { l1: { l2: { l3: { value: "override" } } } };
    expect(deepMerge(base, override)).toEqual({
      l1: { l2: { l3: { value: "override" } } },
    });
  });

  it("handles empty base", () => {
    const override = { a: 1, b: { c: 2 } };
    expect(deepMerge({}, override)).toEqual({ a: 1, b: { c: 2 } });
  });
});
