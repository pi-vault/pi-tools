/**
 * Global trust registry using Symbol.for() so state survives across
 * event handlers within the same process. Trust state is recorded from
 * Pi's ExtensionContext (ctx.isProjectTrusted()) and cached for use by
 * loadMergedConfig() which runs outside an event context.
 */

const TRUST_SYMBOL = Symbol.for("pi-tools.project-trust");

interface TrustRegistry {
  trusted?: Map<string, boolean>;
}

function trustRegistry(): TrustRegistry {
  const host = globalThis as unknown as Record<PropertyKey, TrustRegistry | undefined>;
  return (host[TRUST_SYMBOL] ??= {});
}

/**
 * Record trust state from an event handler that has access to ExtensionContext.
 * Called from session_start, model_select, and before_provider_request handlers.
 */
export function recordProjectTrust(ctx: {
  cwd?: string;
  isProjectTrusted?: () => boolean;
}): void {
  if (!ctx.cwd) return;
  const trusted = ctx.isProjectTrusted?.() === true;
  const registry = trustRegistry();
  registry.trusted ??= new Map();
  registry.trusted.set(ctx.cwd, trusted);
}

/**
 * Check cached trust state for a project directory.
 * Returns false if the project has not been recorded yet (safe default).
 */
export function isProjectTrustedCached(cwd: string): boolean {
  return trustRegistry().trusted?.get(cwd) === true;
}

/** Reset trust registry — exposed for testing only. */
export function _resetTrustRegistry(): void {
  const host = globalThis as unknown as Record<PropertyKey, TrustRegistry | undefined>;
  host[TRUST_SYMBOL] = {};
}
