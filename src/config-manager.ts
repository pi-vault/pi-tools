import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { PiToolsConfig, ProviderConfigEntry } from "./config.ts";
import { loadMergedConfig, resolveApiKey, clearCredentialCache } from "./config.ts";
import type { ProviderRegistry } from "./providers/registry.ts";
import type { ProviderMeta } from "./providers/types.ts";

interface ConfigChangeSet {
  added: string[];
  removed: string[];
  changed: string[];
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
  const changed: string[] = [];

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
      const { apiKey: _prevKey, ...prevStructure } = prevEntry;
      const { apiKey: _nextKey, ...nextStructure } = nextEntry;
      if (
        prevResolved !== nextResolved ||
        JSON.stringify(prevStructure) !== JSON.stringify(nextStructure)
      ) {
        changed.push(name);
      }
    }
  }

  return { added, removed, changed };
}

const CONFIG_TTL_MS = 30_000;

export class ConfigManager {
  private _config: PiToolsConfig;
  private cacheTime: number;
  private readonly cwd: string;
  private readonly registry: ProviderRegistry;
  private readonly metaByName: Map<string, ProviderMeta>;
  private readonly modelRegistry?: ModelRegistry;

  constructor(
    cwd: string,
    registry: ProviderRegistry,
    providerMetas: ProviderMeta[],
    modelRegistry?: ModelRegistry,
  ) {
    this.cwd = cwd;
    this.registry = registry;
    this.metaByName = new Map(providerMetas.map((m) => [m.name, m]));
    this.modelRegistry = modelRegistry;
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

    clearCredentialCache();

    let nextConfig: PiToolsConfig;
    try {
      nextConfig = loadMergedConfig(this.cwd, true);
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
    for (const name of changeSet.changed) {
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

    // Inject global ssrf.allowRanges into the per-provider config passed to meta.create.
    const configWithSsrf = { ...providerConfig, ssrfAllowRanges: config.ssrf.allowRanges };

    let instances: ReturnType<typeof meta.create>;
    try {
      instances = meta.create(resolvedKey, configWithSsrf, this.modelRegistry);
    } catch {
      // Provider instantiation failed — skip, other providers unaffected
      return;
    }
    this.registry.registerProvider(instances, {
      name,
      tier: meta.tier,
      budget: providerConfig.budget,
      config: configWithSsrf,
      usageCost: meta.usageCost,
    });
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
