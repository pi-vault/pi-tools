export interface StoredContent {
  id: string;
  url: string;
  title?: string;
  text: string;
  chars: number;
  storedAt: string;
  source: "web_fetch" | "web_docs_fetch";
}

export type AppendEntryFn = (customType: string, data: unknown) => void;

export class ContentStore {
  private items = new Map<string, StoredContent>();
  private appendEntry: AppendEntryFn;

  constructor(appendEntry: AppendEntryFn) {
    this.appendEntry = appendEntry;
  }

  store(input: {
    url: string;
    title?: string;
    text: string;
    source: "web_fetch" | "web_docs_fetch";
  }): string {
    const id = `wc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stored: StoredContent = {
      id,
      url: input.url,
      title: input.title,
      text: input.text,
      chars: input.text.length,
      storedAt: new Date().toISOString(),
      source: input.source,
    };
    this.items.set(id, stored);
    this.appendEntry("pi-tools-content", stored);
    return id;
  }

  get(id: string): StoredContent | undefined {
    return this.items.get(id);
  }

  restore(entries: StoredContent[]): void {
    for (const entry of entries) {
      this.items.set(entry.id, entry);
    }
  }
}
