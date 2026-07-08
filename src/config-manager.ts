import type { PiToolsConfig, ProviderConfigEntry } from "./config.ts";

export interface ConfigChangeSet {
  added: string[];
  removed: string[];
  keyChanged: string[];
  configChanged: boolean;
}

function isEnabled(entry: ProviderConfigEntry | undefined): boolean {
  return entry !== undefined && entry.enabled !== false;
}

/**
 * Compare two configs and return what changed.
 *
 * `resolveKey` is injected so callers can pass `resolveApiKey` (or a test stub).
 */
export function diffConfig(
  prev: PiToolsConfig,
  next: PiToolsConfig,
  resolveKey: (apiKey: string | undefined) => string | undefined,
): ConfigChangeSet {
  const added: string[] = [];
  const removed: string[] = [];
  const keyChanged: string[] = [];

  const allNames = new Set([
    ...Object.keys(prev.providers),
    ...Object.keys(next.providers),
  ]);

  for (const name of allNames) {
    const prevEntry = prev.providers[name];
    const nextEntry = next.providers[name];
    const wasPrevEnabled = isEnabled(prevEntry);
    const isNextEnabled = isEnabled(nextEntry);

    if (!wasPrevEnabled && isNextEnabled) {
      added.push(name);
    } else if (wasPrevEnabled && !isNextEnabled) {
      removed.push(name);
    } else if (wasPrevEnabled && isNextEnabled) {
      const prevResolved = resolveKey(prevEntry?.apiKey);
      const nextResolved = resolveKey(nextEntry?.apiKey);
      if (prevResolved !== nextResolved) {
        keyChanged.push(name);
      }
    }
  }

  const configChanged =
    prev.selectionStrategy !== next.selectionStrategy ||
    prev.defaultProvider !== next.defaultProvider ||
    JSON.stringify(prev.guidance) !== JSON.stringify(next.guidance);

  return { added, removed, keyChanged, configChanged };
}
