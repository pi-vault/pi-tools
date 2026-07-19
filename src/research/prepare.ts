import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { researchModeDefaults, type ResearchMode, type ResearchModeDefaults } from "./types.ts";

export const MAX_CONTEXT_FILES = 25;

export interface WebResearchInput {
  query?: string;
  queryFile?: string;
  contextFiles?: string[];
  contextGlob?: string;
  researchMode?: ResearchMode;
  type?: string;
  systemPrompt?: string;
  additionalQueries?: string[];
  numResults?: number;
  textMaxCharacters?: number;
  highlightsMaxCharacters?: number;
  highlightNumSentences?: number;
  highlightsPerUrl?: number;
  summaryQuery?: string;
  maxAgeHours?: number;
  category?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  outputSchema?: Record<string, unknown>;
  outputPath?: string;
  reportTitle?: string;
  reportFormat?: string;
  rawOutputPath?: string;
}

type ModeDefaultOverrides = Partial<Record<ResearchMode, Partial<ResearchModeDefaults>>>;

function cleanPath(p: string): string {
  return p.startsWith("@") ? p.slice(1) : p;
}

export function resolveOutputPath(cwd: string, rawPath: string): string {
  const cleaned = cleanPath(rawPath.trim());
  return isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned);
}

export async function expandSimpleGlob(
  cwd: string,
  rawGlob: string,
  limit = MAX_CONTEXT_FILES,
): Promise<string[]> {
  const cleaned = cleanPath(rawGlob.trim());
  if (!cleaned.includes("*")) return [resolveOutputPath(cwd, cleaned)];

  const normalized = cleaned.replace(/\\/g, "/");

  if (normalized.split("*").length > 2) {
    throw new Error(`contextGlob supports one '*' wildcard in the path: ${rawGlob}`);
  }

  const slash = normalized.lastIndexOf("/");
  const dirPart = slash >= 0 ? normalized.slice(0, slash) : ".";
  const basePattern = slash >= 0 ? normalized.slice(slash + 1) : normalized;

  const [prefix, suffix] = basePattern.split("*") as [string, string];
  const dir = resolveOutputPath(cwd, dirPart);
  const entries = await readdir(dir, { withFileTypes: true });
  const matches = entries
    .filter(
      (entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(suffix),
    )
    .map((entry) => join(dir, entry.name))
    .sort();

  if (matches.length > limit) {
    throw new Error(`contextGlob matched ${matches.length} files; limit is ${limit}: ${rawGlob}`);
  }
  return matches;
}

export function applyResearchMode(
  input: Pick<
    WebResearchInput,
    | "researchMode"
    | "type"
    | "numResults"
    | "textMaxCharacters"
    | "highlightsMaxCharacters"
    | "highlightNumSentences"
    | "highlightsPerUrl"
    | "summaryQuery"
    | "maxAgeHours"
    | "category"
    | "outputSchema"
  >,
  configDefaults?: ModeDefaultOverrides,
) {
  const researchMode: ResearchMode = (input.researchMode as ResearchMode) ?? "standard";
  const defaults = researchModeDefaults[researchMode];
  if (!defaults) {
    throw new Error(
      `Invalid researchMode '${researchMode}'. Expected one of: lite, standard, full.`,
    );
  }
  const profile = configDefaults?.[researchMode] ?? {};
  const type = input.type ?? profile.type ?? defaults.type;
  if (type !== "deep-lite" && type !== "deep" && type !== "deep-reasoning") {
    throw new Error(
      `Invalid research type '${type}'. Expected deep-lite, deep, or deep-reasoning.`,
    );
  }
  const numResults = input.numResults ?? profile.numResults ?? defaults.numResults;
  if (!Number.isInteger(numResults) || numResults < 1 || numResults > 100) {
    throw new Error("numResults must be an integer from 1 to 100.");
  }

  return {
    researchMode,
    type,
    numResults,
    textMaxCharacters:
      input.textMaxCharacters ?? profile.textMaxCharacters ?? defaults.textMaxCharacters,
    timeoutSeconds: profile.timeoutSeconds ?? defaults.timeoutSeconds,
    highlightsMaxCharacters:
      input.highlightsMaxCharacters ??
      profile.highlightsMaxCharacters ??
      defaults.highlightsMaxCharacters,
    highlightNumSentences:
      input.highlightNumSentences ??
      profile.highlightNumSentences ??
      defaults.highlightNumSentences,
    highlightsPerUrl:
      input.highlightsPerUrl ?? profile.highlightsPerUrl ?? defaults.highlightsPerUrl,
    summaryQuery: input.summaryQuery ?? profile.summaryQuery ?? defaults.summaryQuery,
    maxAgeHours: input.maxAgeHours ?? profile.maxAgeHours ?? defaults.maxAgeHours,
    category: input.category ?? profile.category ?? defaults.category,
    outputSchema: input.outputSchema ?? profile.outputSchema ?? defaults.outputSchema,
  };
}

async function resolveContextPaths(cwd: string, params: WebResearchInput): Promise<string[]> {
  const explicit = (params.contextFiles ?? []).map((p) => resolveOutputPath(cwd, p));
  const globbed = params.contextGlob ? await expandSimpleGlob(cwd, params.contextGlob) : [];
  return Array.from(new Set([...explicit, ...globbed])).sort();
}

const DEFAULT_SYSTEM_PROMPT =
  "You are producing an evidence-backed research findings report. Prioritize primary sources, current documentation, tradeoffs, risks, and concrete revisit conditions. Include source URLs for material claims when Exa returns citations.";

export async function prepareResearchInput(
  cwd: string,
  params: WebResearchInput,
): Promise<WebResearchInput & { query: string; systemPrompt: string }> {
  let query = params.query?.trim() ?? "";
  if (params.queryFile) {
    query = (await readFile(resolveOutputPath(cwd, params.queryFile), "utf8")).trim();
  }
  if (!query) throw new Error("web_research requires query or queryFile.");

  const contextPaths = await resolveContextPaths(cwd, params);
  const contextParts: string[] = [];
  for (const p of contextPaths) {
    contextParts.push(`Context from ${p}:\n${await readFile(p, "utf8")}`);
  }

  const basePrompt = params.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  const systemPrompt = contextParts.length
    ? [basePrompt, ...contextParts].join("\n\n---\n\n")
    : basePrompt;

  return { ...params, query, systemPrompt };
}
