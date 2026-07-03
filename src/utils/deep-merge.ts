/**
 * Check whether a value is a plain object (not null, not an array, not a class instance).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-merge two plain objects. Override values take precedence.
 *
 * Rules:
 * - Nested plain objects are merged recursively.
 * - Arrays and scalars from `override` replace `base` values.
 * - `null` in override replaces the base value.
 * - `undefined` in override is skipped (base value preserved).
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = {};

  // Copy all base keys (deep-clone nested objects)
  for (const key of Object.keys(base)) {
    const baseVal = base[key];
    result[key] = isPlainObject(baseVal) ? deepMerge(baseVal, {}) : baseVal;
  }

  // Apply override keys
  for (const key of Object.keys(override)) {
    const overrideVal = override[key];

    // Skip undefined — preserve base value
    if (overrideVal === undefined) continue;

    const baseVal = result[key];

    // Recursively merge only when both sides are plain objects
    if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      result[key] = deepMerge(baseVal, overrideVal);
    } else {
      result[key] = overrideVal;
    }
  }

  return result as T;
}
