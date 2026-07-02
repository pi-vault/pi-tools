import type { SearchFilters } from "../providers/types.ts";

/** Prepends site:/‑site: operators to a query for providers that use query manipulation. */
export function applyDomainFilters(query: string, filters?: SearchFilters): string {
  if (!filters) return query;

  const parts: string[] = [];

  if (filters.includeDomains?.length) {
    parts.push(filters.includeDomains.map((d) => `site:${d}`).join(" OR "));
  }

  if (filters.excludeDomains?.length) {
    parts.push(filters.excludeDomains.map((d) => `-site:${d}`).join(" "));
  }

  if (parts.length === 0) return query;
  return `${parts.join(" ")} ${query}`;
}
