import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { ExaDeepResearchClient } from "../providers/exa-deep-research.ts";
import type { DeepResearchConfig, GuidanceOverride } from "../config.ts";
import type { AppendEntryFn } from "../storage.ts";
import type { ExaDeepType, ReportFormat } from "../research/types.ts";
import { applyResearchMode, prepareResearchInput, resolveOutputPath } from "../research/prepare.ts";
import { buildRawSidecar, defaultRawOutputPath, renderFindingsReport } from "../research/report.ts";

const WebResearchParams = Type.Object({
  query: Type.Optional(
    Type.String({
      description: "Research question to investigate with Exa Deep Search.",
    }),
  ),
  queryFile: Type.Optional(
    Type.String({
      description: "Path to a file containing the research question.",
    }),
  ),
  contextFiles: Type.Optional(
    Type.Array(Type.String(), {
      description: "Context files to append to system prompt.",
    }),
  ),
  contextGlob: Type.Optional(
    Type.String({
      description: "Simple glob for context files (one * in filename).",
    }),
  ),
  researchMode: Type.Optional(
    Type.Union([Type.Literal("lite"), Type.Literal("standard"), Type.Literal("full")], {
      description: "Research depth: lite, standard (default), or full.",
    }),
  ),
  type: Type.Optional(
    Type.String({
      description: "Override Exa deep type: deep-reasoning, deep-lite, or deep.",
    }),
  ),
  systemPrompt: Type.Optional(
    Type.String({
      description: "Override the default research system prompt.",
    }),
  ),
  additionalQueries: Type.Optional(
    Type.Array(Type.String(), { description: "Extra queries for full mode." }),
  ),
  numResults: Type.Optional(Type.Number({ description: "Number of source results." })),
  textMaxCharacters: Type.Optional(Type.Number({ description: "Max text characters per source." })),
  highlightsMaxCharacters: Type.Optional(Type.Number({ description: "Max highlight characters." })),
  highlightNumSentences: Type.Optional(Type.Number({ description: "Sentences per highlight." })),
  highlightsPerUrl: Type.Optional(Type.Number({ description: "Highlights per URL." })),
  summaryQuery: Type.Optional(Type.String({ description: "Summary query for Exa." })),
  maxAgeHours: Type.Optional(Type.Number({ description: "Max age of sources in hours." })),
  category: Type.Optional(Type.String({ description: "Exa content category filter." })),
  includeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Only include results from these domains.",
    }),
  ),
  excludeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Exclude results from these domains.",
    }),
  ),
  startPublishedDate: Type.Optional(
    Type.String({
      description: "Only sources published after this date (ISO 8601).",
    }),
  ),
  endPublishedDate: Type.Optional(
    Type.String({
      description: "Only sources published before this date (ISO 8601).",
    }),
  ),
  outputSchema: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Custom structured output schema.",
    }),
  ),
  outputPath: Type.Optional(Type.String({ description: "Path to write findings report." })),
  reportTitle: Type.Optional(Type.String({ description: "Custom title for the findings report." })),
  reportFormat: Type.Optional(
    Type.Union([Type.Literal("findings"), Type.Literal("markdown"), Type.Literal("json")], {
      description: "Report format: findings (default), markdown, or json.",
    }),
  ),
  rawOutputPath: Type.Optional(Type.String({ description: "Path for raw metadata sidecar." })),
});

interface WebResearchDetails {
  outputPath?: string;
  sourceCount: number;
}

async function writeQueued(path: string, content: string): Promise<void> {
  await withFileMutationQueue(path, async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  });
}

function displayPath(cwd: string | undefined, filePath: string): string {
  if (!cwd) return filePath;
  const rel = relative(cwd, filePath);
  return rel && !rel.startsWith("..") ? rel : filePath;
}

export function createWebResearchTool(
  exaApiKey: string,
  deepResearchConfig: DeepResearchConfig,
  appendEntry: AppendEntryFn,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebResearchParams, WebResearchDetails> {
  return {
    name: "web_research",
    label: "Web Research",
    description:
      "Run Exa Deep Search and optionally write a findings report. Requires EXA_API_KEY.",
    promptSnippet:
      guidance?.promptSnippet ??
      "Run Exa deep research for evidence-backed findings reports. Pass outputPath to save results to disk.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_research for multi-source research that needs structured findings reports.",
      "Choose researchMode based on depth: lite (quick, 5min), standard (default, 10min), full (thorough, 30min).",
      "Pass outputPath when the user asks for a saved report or findings file.",
    ],
    parameters: WebResearchParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      // Defense-in-depth: config is captured at registration time
      if (!deepResearchConfig.enabled) {
        throw new Error("web_research is disabled via deepResearch.enabled config.");
      }

      const cwd = ctx.cwd;
      const prepared = await prepareResearchInput(cwd, params);
      const mode = applyResearchMode(prepared, deepResearchConfig.modeDefaults);

      const client = new ExaDeepResearchClient(exaApiKey);

      // Full mode runs multiple queries with deduplication
      const queryList =
        mode.researchMode === "full"
          ? [prepared.query, ...(prepared.additionalQueries ?? [])]
              .map((q) => q.trim())
              .filter(Boolean)
          : [prepared.query];
      const uniqueQueries = Array.from(new Set(queryList));

      // Execute research queries
      const responses = [];
      for (const query of uniqueQueries) {
        responses.push(
          await client.deepResearch(
            {
              query,
              type: mode.type as ExaDeepType,
              numResults: mode.numResults,
              textMaxCharacters: mode.textMaxCharacters,
              highlightsMaxCharacters: mode.highlightsMaxCharacters,
              highlightNumSentences: mode.highlightNumSentences,
              highlightsPerUrl: mode.highlightsPerUrl,
              summaryQuery: mode.summaryQuery,
              maxAgeHours: mode.maxAgeHours,
              category: mode.category,
              includeDomains: prepared.includeDomains,
              excludeDomains: prepared.excludeDomains,
              startPublishedDate: prepared.startPublishedDate,
              endPublishedDate: prepared.endPublishedDate,
              additionalQueries:
                mode.researchMode === "full" ? undefined : prepared.additionalQueries,
              systemPrompt: prepared.systemPrompt,
              outputSchema: mode.outputSchema,
            },
            signal ?? undefined,
          ),
        );
      }

      // Deduplicate results across queries
      const seen = new Set<string>();
      const uniqueResults = [];
      let sourceCount = 0;
      for (const resp of responses) {
        sourceCount += resp.results.length;
        for (const r of resp.results) {
          const key = (r.url || r.title || JSON.stringify(r)).trim().toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          uniqueResults.push(r);
        }
      }

      // Build merged response
      const mergedAnswer =
        responses
          .map((r) => r.answer?.trim())
          .filter(Boolean)
          .join("\n\n") || undefined;
      const mergedRaw =
        responses.length === 1
          ? responses[0].raw
          : {
              responses: responses.map((r) => r.raw),
              results: uniqueResults,
              answer: mergedAnswer,
            };
      const response = {
        answer: mergedAnswer,
        results: uniqueResults,
        raw: mergedRaw,
        metadata: {
          researchMode: mode.researchMode,
          type: mode.type,
          numResults: mode.numResults,
          textMaxCharacters: mode.textMaxCharacters,
          timeoutSeconds: mode.timeoutSeconds,
          queryCount: uniqueQueries.length,
          sourceCount,
          uniqueSourceCount: uniqueResults.length,
        },
      };

      // Determine output paths
      const format: ReportFormat = (params.reportFormat as ReportFormat) ?? "findings";
      let outputPath: string | undefined;
      let rawOutputPath: string | undefined;
      if (params.outputPath) {
        outputPath = resolveOutputPath(cwd, params.outputPath);
        if (format === "findings") {
          rawOutputPath = params.rawOutputPath
            ? resolveOutputPath(cwd, params.rawOutputPath)
            : defaultRawOutputPath(outputPath);
        } else if (format === "markdown" && params.rawOutputPath) {
          rawOutputPath = resolveOutputPath(cwd, params.rawOutputPath);
        }
      } else if (params.rawOutputPath) {
        rawOutputPath = resolveOutputPath(cwd, params.rawOutputPath);
      }

      // Render report
      const report =
        format === "json"
          ? JSON.stringify(response.raw, null, 2)
          : renderFindingsReport(prepared, response, { rawOutputPath });

      // Write files
      if (outputPath) {
        await writeQueued(outputPath, report);
      }
      if (rawOutputPath) {
        await writeQueued(
          rawOutputPath,
          JSON.stringify(buildRawSidecar(response, rawOutputPath), null, 2),
        );
      }

      // Track in session
      appendEntry("pi-tools-research", {
        query: prepared.query,
        outputPath,
        rawOutputPath,
        metadata: response.metadata,
        sourceCount: uniqueResults.length,
      });

      // Return result
      const text = outputPath
        ? `Exa deep research complete. Report: ${displayPath(cwd, outputPath)}\nSources: ${uniqueResults.length}${rawOutputPath ? `\nRaw metadata: ${displayPath(cwd, rawOutputPath)}` : ""}`
        : report;

      return {
        content: [{ type: "text" as const, text }],
        details: {
          outputPath,
          sourceCount: uniqueResults.length,
        },
      };
    },
    renderCall(args, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Researching..."));
        return text;
      }
      const mode = args.researchMode ?? "standard";
      const queryPreview = args.query ?? args.queryFile ?? "research";
      const preview = queryPreview.length > 60 ? `${queryPreview.slice(0, 57)}...` : queryPreview;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_research"))} ${theme.fg("accent", `"${preview}"`)} ${theme.fg("muted", `(${mode})`)}`,
      );
      return text;
    },
    renderResult(result, _options, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Researching..."));
        return text;
      }
      if (context.isError) {
        const errorText =
          result.content[0] && "text" in result.content[0] ? result.content[0].text : "failed";
        text.setText(theme.fg("error", `web_research failed: ${errorText}`));
        return text;
      }
      const details = result.details as WebResearchDetails | undefined;
      const sourceCount = details?.sourceCount ?? 0;
      const outputPath = details?.outputPath;
      const parts = [`web_research complete`, `${sourceCount} sources`];
      if (outputPath) parts.push(`report: ${displayPath(context.cwd, outputPath)}`);
      text.setText(theme.fg("toolOutput", parts.join(" - ")));
      return text;
    },
  };
}
