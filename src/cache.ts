import type { ExtractedContent } from "./extract/pipeline.ts";

interface CacheEntry {
  content: ExtractedContent;
  storedAt: number;
}

export class ContentCache {
  private entries = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(url: string): ExtractedContent | undefined {
    const entry = this.entries.get(url);
    if (!entry) return undefined;

    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.entries.delete(url);
      return undefined;
    }

    return entry.content;
  }

  set(url: string, content: ExtractedContent): void {
    if (this.maxSize <= 0) return;

    // Delete first so re-insert moves to end of insertion order
    if (this.entries.has(url)) {
      this.entries.delete(url);
    }

    while (this.entries.size >= this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }

    this.entries.set(url, { content, storedAt: Date.now() });
  }

  clear(): void {
    this.entries.clear();
  }
}
