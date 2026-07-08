import type { PiToolsConfig, ProviderConfigEntry } from "./config.ts";
import { loadMergedConfig, resolveApiKey } from "./config.ts";
import type { ProviderRegistry } from "./providers/registry.ts";
import type { ProviderMeta } from "./providers/types.ts";

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

  const allNames = new Set([...Object.keys(prev.providers), ...Object.keys(next.providers)]);

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

const CONFIG_TTL_MS = 30_000;

export class ConfigManager {
  private _config: PiToolsConfig;
  private cacheTime: number;
  private readonly cwd: string;
  private readonly registry: ProviderRegistry;
  private readonly metaByName: Map<string, ProviderMeta>;

  constructor(cwd: string, registry: ProviderRegistry, providerMetas: ProviderMeta[]) {
    this.cwd = cwd;
    this.registry = registry;
    this.metaByName = new Map(providerMetas.map((m) => [m.name, m]));
    this._config = loadMergedConfig(cwd);
    this.cacheTime = Date.now();
    this.registerFromConfig(this._config);
  }

  get current(): PiToolsConfig {
    return this._config;
  }

  refresh(force = false): void {
    const now = Date.now();
    if (!force && now - this.cacheTime < CONFIG_TTL_MS) return;

    let nextConfig: PiToolsConfig;
    try {
      nextConfig = loadMergedConfig(this.cwd);
    } catch {
      // Malformed config — keep previous, reset TTL to retry next cycle
      this.cacheTime = now;
      return;
    }

    const changeSet = diffConfig(this._config, nextConfig, resolveApiKey);
    this.applyChanges(changeSet, nextConfig);
    this._config = nextConfig;
    this.cacheTime = now;
  }

  private applyChanges(changeSet: ConfigChangeSet, nextConfig: PiToolsConfig): void {
    for (const name of changeSet.removed) {
      this.registry.unregisterAll(name);
    }
    for (const name of changeSet.keyChanged) {
      this.registry.unregisterAll(name);
      this.registerProvider(name, nextConfig);
    }
    for (const name of changeSet.added) {
      this.registerProvider(name, nextConfig);
    }
  }

  private registerProvider(name: string, config: PiToolsConfig): void {
    const meta = this.metaByName.get(name);
    if (!meta) return;

    const providerConfig = config.providers[name];
    const resolvedKey = resolveApiKey(providerConfig?.apiKey);
    if (meta.requiresKey && !resolvedKey) return;

    const instances = meta.create(resolvedKey, providerConfig);
    const quota = providerConfig?.monthlyQuota ?? meta.monthlyQuota;

    if (instances.search) {
      this.registry.registerSearch(instances.search, { tier: meta.tier, monthlyQuota: quota });
    }
    if (instances.fetch) {
      this.registry.registerFetch(instances.fetch);
    }
    if (instances.codeSearch) {
      this.registry.registerCodeSearch(instances.codeSearch);
    }
    if (instances.docs) {
      this.registry.registerDocs(instances.docs);
    }
  }

  private registerFromConfig(config: PiToolsConfig): void {
    for (const [name, entry] of Object.entries(config.providers)) {
      if (!isEnabled(entry)) continue;
      this.registerProvider(name, config);
    }
  }

  /** @internal Exposed for tests to simulate TTL expiry without time mocking. */
  expireTtlForTest(): void {
    this.cacheTime = 0;
  }
}
