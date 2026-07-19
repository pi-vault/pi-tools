import { describe, expect, it, vi } from "vitest";
import { executeWithFallback } from "../../src/providers/execute.ts";
import { BudgetExceededError } from "../../src/providers/registry.ts";

describe("executeWithFallback", () => {
  it("returns result from first successful candidate", async () => {
    const result = await executeWithFallback({
      candidates: [
        { name: "provider-a", execute: async () => "result-a" },
        { name: "provider-b", execute: async () => "result-b" },
      ],
      operation: "search",
    });
    expect(result.result).toBe("result-a");
    expect(result.providerName).toBe("provider-a");
  });

  it("falls back to second candidate when first fails", async () => {
    const result = await executeWithFallback({
      candidates: [
        {
          name: "failing",
          execute: async () => {
            throw new Error("timeout");
          },
        },
        { name: "working", execute: async () => "fallback-result" },
      ],
      operation: "search",
    });
    expect(result.result).toBe("fallback-result");
    expect(result.providerName).toBe("working");
  });

  it("does not return a provider result after cancellation", async () => {
    const controller = new AbortController();

    await expect(
      executeWithFallback({
        candidates: [
          {
            name: "ignores-signal",
            execute: async () => {
              controller.abort();
              return "stale-result";
            },
          },
        ],
        operation: "fetch",
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");
  });

  it("throws AggregateProviderError when all candidates fail", async () => {
    await expect(
      executeWithFallback({
        candidates: [
          {
            name: "a",
            execute: async () => {
              throw new Error("err-a");
            },
          },
          {
            name: "b",
            execute: async () => {
              throw new Error("err-b");
            },
          },
        ],
        operation: "fetch",
      }),
    ).rejects.toThrow("All fetch providers failed");
  });

  it("calls onSuccess with provider name and latency on success", async () => {
    const onSuccess = vi.fn();
    await executeWithFallback({
      candidates: [{ name: "fast", execute: async () => "ok" }],
      operation: "search",
      onSuccess,
    });
    expect(onSuccess).toHaveBeenCalledWith("fast", expect.any(Number));
  });

  it("calls onFailure for each failed candidate", async () => {
    const onFailure = vi.fn();
    await executeWithFallback({
      candidates: [
        {
          name: "bad",
          execute: async () => {
            throw new Error("x");
          },
        },
        { name: "good", execute: async () => "ok" },
      ],
      operation: "search",
      onFailure,
    });
    expect(onFailure).toHaveBeenCalledWith("bad");
    expect(onFailure).not.toHaveBeenCalledWith("good");
  });

  it("falls back after budget rejection without recording a performance failure", async () => {
    const onFailure = vi.fn();
    const result = await executeWithFallback({
      candidates: [
        {
          name: "exhausted",
          execute: async () => {
            throw new BudgetExceededError("exhausted", 1, {
              mode: "hard",
              used: 1,
              limit: 1,
              unit: "request",
              period: "month",
              periodKey: "2026-07",
            });
          },
        },
        { name: "available", execute: async () => "ok" },
      ],
      operation: "search",
      onFailure,
    });

    expect(result.providerName).toBe("available");
    expect(onFailure).not.toHaveBeenCalledWith("exhausted");
  });

  it("throws when candidates array is empty", async () => {
    await expect(
      executeWithFallback({
        candidates: [],
        operation: "search",
      }),
    ).rejects.toThrow("No search providers available");
  });
});
