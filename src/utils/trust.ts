/**
 * Global trust registry using Symbol.for() so state survives across
 * event handlers within the same process. Cached for loadMergedConfig()
 * which runs outside an event context.
 */

const SYM = Symbol.for("pi-tools.project-trust");
const registry = (): Map<string, boolean> =>
  ((globalThis as any)[SYM] ??= new Map());

/** Record trust state from an event handler with ExtensionContext access. */
export function recordProjectTrust(ctx: {
  cwd?: string;
  isProjectTrusted?: () => boolean;
}): void {
  if (!ctx.cwd) return;
  registry().set(ctx.cwd, ctx.isProjectTrusted?.() === true);
}

/** Check cached trust. Returns false (safe default) when unrecorded. */
export function isProjectTrustedCached(cwd: string): boolean {
  return registry().get(cwd) === true;
}

/** Reset — testing only. */
export function _resetTrustRegistry(): void {
  (globalThis as any)[SYM] = new Map();
}
