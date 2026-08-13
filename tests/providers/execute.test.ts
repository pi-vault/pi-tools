import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeAttempt, executeWithFallback } from "../../src/providers/execute.ts";
import { activityMonitor } from "../../src/monitor/activity-monitor.ts";
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

describe("executeAttempt", () => {
  beforeEach(() => {
    activityMonitor.clear();
  });

  it("logs one start and one completion on success", async () => {
    const onSuccess = vi.fn();
    await executeAttempt({
      candidate: { name: "exa", execute: async () => "ok" },
      operation: "search",
      onSuccess,
    });
    const entries = activityMonitor.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe(200);
    expect(entries[0].query).toBe("search");
    expect(onSuccess).toHaveBeenCalledWith("exa", expect.any(Number));
  });

  it("uses activityQuery override for activity label", async () => {
    await executeAttempt({
      candidate: { name: "exa", execute: async () => "ok" },
      operation: "search",
      activityQuery: "fusion:exa",
    });
    const entries = activityMonitor.getEntries();
    expect(entries[0].query).toBe("fusion:exa");
  });

  it("records failure then success with one error, one completion, and both hooks", async () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const result = await executeWithFallback({
      candidates: [
        {
          name: "first",
          execute: async () => {
            throw new Error("boom");
          },
        },
        { name: "second", execute: async () => "fallback" },
      ],
      operation: "search",
      onSuccess,
      onFailure,
    });
    expect(result.providerName).toBe("second");
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith("first");
    expect(onSuccess).toHaveBeenCalledWith("second", expect.any(Number));
    const entries = activityMonitor.getEntries();
    expect(entries[0].status).toBe(-1);
    expect(entries[0].error).toContain("boom");
    expect(entries[1].status).toBe(200);
  });

  it("aggregates budget rejection without calling onFailure", async () => {
    const onSuccess = vi.fn();
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
      onSuccess,
      onFailure,
    });
    expect(result.providerName).toBe("available");
    expect(onFailure).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith("available", expect.any(Number));
  });

  it("rethrows pre-attempt cancellation without onFailure", async () => {
    const onFailure = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeAttempt({
        candidate: { name: "exa", execute: async () => "never" },
        operation: "search",
        signal: controller.signal,
        onFailure,
      }),
    ).rejects.toThrow("aborted");
    expect(onFailure).not.toHaveBeenCalled();
    expect(activityMonitor.getEntries()).toEqual([]);
  });

  it("rethrows in-flight cancellation without onFailure", async () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const controller = new AbortController();
    await expect(
      executeAttempt({
        candidate: {
          name: "exa",
          execute: async () => {
            controller.abort();
            return "stale-result";
          },
        },
        operation: "search",
        signal: controller.signal,
        onSuccess,
        onFailure,
      }),
    ).rejects.toThrow("aborted");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("sanitizes activity error messages", async () => {
    await expect(
      executeAttempt({
        candidate: {
          name: "exa",
          execute: async () => {
            throw new Error("bearer abcdefghijklmnop leaked token in message");
          },
        },
        operation: "search",
      }),
    ).rejects.toThrow();
    const entries = activityMonitor.getEntries();
    expect(entries[0].error).not.toContain("abcdefghijklmnop");
    expect(entries[0].error).toContain("redacted");
  });
});
