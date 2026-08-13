import type {
  SearchFilterSupport,
  SearchFilters,
  SearchResult,
} from "../providers/types.ts";

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

function hostMatchesDomain(urlValue: string, domain: string): boolean {
  try {
    const host = new URL(urlValue).hostname.toLowerCase();
    const normalized = domain
      .trim()
      .toLowerCase()
      .replace(/^\.+|\.+$/g, "");
    return (
      normalized.length > 0 &&
      (host === normalized || host.endsWith(`.${normalized}`))
    );
  } catch {
    return false;
  }
}

export function filterResultsByDomains(
  results: SearchResult[],
  filters?: SearchFilters,
): SearchResult[] {
  if (!filters?.includeDomains?.length && !filters?.excludeDomains?.length)
    return results;

  return results.filter((result) => {
    const included =
      !filters.includeDomains?.length ||
      filters.includeDomains.some((domain) =>
        hostMatchesDomain(result.url, domain),
      );
    const excluded =
      filters.excludeDomains?.some((domain) =>
        hostMatchesDomain(result.url, domain),
      ) ?? false;
    return included && !excluded;
  });
}

export function unsupportedSearchFilters(
  filters: SearchFilters | undefined,
  support: SearchFilterSupport,
): string[] {
  const unsupported: string[] = [];
  if (
    (filters?.includeDomains?.length || filters?.excludeDomains?.length) &&
    support.domains === "unsupported"
  ) {
    unsupported.push("domains");
  }
  if (
    (filters?.startDate || filters?.endDate) &&
    support.dates === "unsupported"
  ) {
    unsupported.push("dates");
  }
  return unsupported;
}