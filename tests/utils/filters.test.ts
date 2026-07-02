import { describe, expect, it } from "vitest";
import { applyDomainFilters } from "../../src/utils/filters.ts";

describe("applyDomainFilters", () => {
  it("returns query unchanged when no filters", () => {
    expect(applyDomainFilters("test query")).toBe("test query");
    expect(applyDomainFilters("test query", undefined)).toBe("test query");
  });

  it("prepends site: for includeDomains", () => {
    const result = applyDomainFilters("test", { includeDomains: ["a.com", "b.com"] });
    expect(result).toBe("site:a.com OR site:b.com test");
  });

  it("prepends -site: for excludeDomains", () => {
    const result = applyDomainFilters("test", { excludeDomains: ["spam.com", "junk.com"] });
    expect(result).toBe("-site:spam.com -site:junk.com test");
  });

  it("combines include and exclude", () => {
    const result = applyDomainFilters("query", {
      includeDomains: ["a.com"],
      excludeDomains: ["b.com"],
    });
    expect(result).toBe("site:a.com -site:b.com query");
  });

  it("returns query unchanged for empty arrays", () => {
    expect(applyDomainFilters("test", { includeDomains: [], excludeDomains: [] })).toBe("test");
  });
});
