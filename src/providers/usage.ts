import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

interface UsageData {
  resetAt: string;
  counts: Record<string, number>;
}

function getUsagePath(): string {
  return path.join(os.homedir(), ".pi", "agent", "tools-usage.json");
}

function getLegacyUsagePath(): string {
  return path.join(os.homedir(), ".pi", "agent", "pi-tools-usage.json");
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export class UsageTracker {
  private counts: Record<string, number> = {};
  private resetAt: string;

  constructor() {
    this.resetAt = getCurrentMonth();
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(getUsagePath(), "utf-8");
      const data: UsageData = JSON.parse(raw);
      if (data.resetAt === this.resetAt) {
        this.counts = data.counts ?? {};
      }
      // If month changed, counts stay at 0 (already initialized)
    } catch {
      // Try legacy path
      try {
        const raw = fs.readFileSync(getLegacyUsagePath(), "utf-8");
        const data: UsageData = JSON.parse(raw);
        if (data.resetAt === this.resetAt) {
          this.counts = data.counts ?? {};
        }
      } catch {
        // No file or parse error — start fresh
      }
    }
  }

  private save(): void {
    const filePath = getUsagePath();
    const data: UsageData = {
      resetAt: this.resetAt,
      counts: this.counts,
    };
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch {
      // Non-fatal: usage tracking is best-effort
    }
  }

  getCount(provider: string): number {
    return this.counts[provider] ?? 0;
  }

  getRemaining(provider: string, monthlyQuota: number | null): number {
    if (monthlyQuota === null) return Infinity;
    return Math.max(0, monthlyQuota - this.getCount(provider));
  }

  increment(provider: string): void {
    this.counts[provider] = (this.counts[provider] ?? 0) + 1;
    this.save();
  }
}
