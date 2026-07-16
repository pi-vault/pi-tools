export interface ActivityEntry {
  id: string;
  type: "api" | "fetch";
  startTime: number;
  endTime?: number;
  query?: string;
  url?: string;
  status: number | null;
  error?: string;
}

const MAX_ENTRIES = 10;

export class ActivityMonitor {
  private entries: ActivityEntry[] = [];
  private listeners = new Set<() => void>();
  private nextId = 1;

  logStart(
    partial: Omit<ActivityEntry, "id" | "startTime" | "status">,
  ): string {
    const id = String(this.nextId++);
    const entry: ActivityEntry = {
      ...partial,
      id,
      startTime: Date.now(),
      status: null,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    this.notify();
    return id;
  }

  logComplete(id: string, status: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.status = status;
    entry.endTime = Date.now();
    this.notify();
  }

  logError(id: string, error: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.status = -1;
    entry.error = error;
    entry.endTime = Date.now();
    this.notify();
  }

  getEntries(): ReadonlyArray<ActivityEntry> {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  onUpdate(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify(): void {
    for (const cb of this.listeners) {
      cb();
    }
  }
}

export const activityMonitor = new ActivityMonitor();
