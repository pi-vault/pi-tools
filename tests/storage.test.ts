import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentStore, type StoredContent } from "../src/storage.ts";

describe("ContentStore", () => {
  let store: ContentStore;
  const mockAppendEntry = vi.fn();

  beforeEach(() => {
    store = new ContentStore(mockAppendEntry);
    mockAppendEntry.mockClear();
  });

  it("stores and retrieves content by ID", () => {
    const id = store.store({
      url: "https://example.com",
      title: "Example",
      text: "Hello world",
      source: "web_fetch",
    });

    expect(id).toMatch(/^wc-/);
    const retrieved = store.get(id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.text).toBe("Hello world");
    expect(retrieved?.url).toBe("https://example.com");
    expect(retrieved?.title).toBe("Example");
    expect(retrieved?.source).toBe("web_fetch");
    expect(retrieved?.chars).toBe(11);
    expect(retrieved?.storedAt).toBeDefined();
  });

  it("returns undefined for unknown content ID", () => {
    expect(store.get("wc-nonexistent")).toBeUndefined();
  });

  it("calls appendEntry on store", () => {
    store.store({
      url: "https://example.com",
      text: "content",
      source: "web_search",
    });
    expect(mockAppendEntry).toHaveBeenCalledWith(
      "pi-tools-content",
      expect.objectContaining({ url: "https://example.com" }),
    );
  });

  it("restores content from session entries", () => {
    const entry: StoredContent = {
      id: "wc-restored-1",
      url: "https://restored.com",
      title: "Restored",
      text: "restored content",
      chars: 16,
      storedAt: new Date().toISOString(),
      source: "web_fetch",
    };
    store.restore([entry]);
    const retrieved = store.get("wc-restored-1");
    expect(retrieved).toBeDefined();
    expect(retrieved?.text).toBe("restored content");
  });
});
