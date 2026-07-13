import { createHttpSearchProvider } from "./http-adapter.ts";
import { applyDomainFilters } from "../utils/filters.ts";
import { parseSerperResults } from "./parsers.ts";
import type { ProviderMeta, SearchFilters } from "./types.ts";

/** Converts "YYYY-MM-DD" to "MM/DD/YYYY" for Google's tbs format. */
function isoToMDY(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}

/**
 * Builds a Google `tbs` (time-based search) parameter string.
 * Format: cdr:1,cd_min:MM/DD/YYYY,cd_max:MM/DD/YYYY
 */
function buildTbs(filters?: SearchFilters): string | null {
  if (!filters) return null;
  if (!filters.startDate && !filters.endDate) return null;
  const min = filters.startDate ? isoToMDY(filters.startDate) : "";
  const max = filters.endDate ? isoToMDY(filters.endDate) : "";
  return `cdr:1,cd_min:${min},cd_max:${max}`;
}

export const providerMeta: ProviderMeta = {
  name: "serper",
  tier: 1,
  monthlyQuota: 2500,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "serper",
      label: "Google Serper",
      endpoint: "https://google.serper.dev/search",
      method: "POST",
      authHeader: "X-API-KEY",
      buildBody: (query, maxResults, filters) => {
        const body: Record<string, unknown> = {
          q: applyDomainFilters(query, filters),
          num: maxResults,
        };
        const tbs = buildTbs(filters);
        if (tbs) body.tbs = tbs;
        return body;
      },
      extractResults: parseSerperResults,
    }),
  }),
};
