import { extname } from "node:path";
import type { DeepResearchResponse } from "./types.ts";
import type { WebResearchInput } from "./prepare.ts";

export function defaultRawOutputPath(outputPath: string): string {
  const ext = extname(outputPath);
  return ext
    ? `${outputPath.slice(0, -ext.length)}.raw.json`
    : `${outputPath}.raw.json`;
}

export interface RawResearchSidecar {
  metadata: Record<string, unknown> & { rawOutputPath?: string };
  raw: unknown;
}

export function buildRawSidecar(
  response: DeepResearchResponse,
  rawOutputPath?: string,
): RawResearchSidecar {
  return {
    metadata: { ...response.metadata, rawOutputPath },
    raw: response.raw,
  };
}

function structuredOutputContent(
  response: DeepResearchResponse,
): Record<string, unknown> | undefined {
  const raw: any = response.raw;
  if (
    raw?.output?.content &&
    typeof raw.output.content === "object" &&
    !Array.isArray(raw.output.content)
  ) {
    return raw.output.content;
  }
  return undefined;
}

function sanitizeEvidenceText(value: string): string {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/g, "")
        .replace(/^\s{0,3}>\s*/g, "")
        .replace(/^\s*```.*$/g, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function oneLine(value: string, max = 260): string {
  const cleaned = sanitizeEvidenceText(value);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}\u2026` : cleaned;
}

function resultSnippet(
  result: DeepResearchResponse["results"][number],
  max = 900,
): string {
  return oneLine(
    [result.summary, ...(result.highlights ?? []), result.text]
      .filter(Boolean)
      .join(" "),
    max,
  );
}

function listMarkdown(value: unknown, fallback: string): string {
  if (Array.isArray(value) && value.length) {
    return value
      .map(
        (item) =>
          `- ${sanitizeEvidenceText(typeof item === "string" ? item : JSON.stringify(item))}`,
      )
      .join("\n");
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function isGenericNoAnswer(value: string | undefined): boolean {
  return (
    !value?.trim() ||
    /Exa returned (sources|\d+ sources) but no synthesized answer field/i.test(
      value,
    )
  );
}

function fallbackSummary(response: DeepResearchResponse): string {
  if (!isGenericNoAnswer(response.answer)) return response.answer!.trim();
  if (response.results.length === 0)
    return "No sources were returned. Re-run with broader terms or fewer filters before making a decision.";
  const themes = response.results
    .slice(0, 5)
    .map((r, i) => `(${i + 1}) ${r.title ?? r.url ?? "Untitled"}`)
    .join("; ");
  return `Exa returned ${response.results.length} sources but no synthesized answer field. The strongest source clusters are: ${themes}. Treat the findings below as an evidence brief and validate recommendations against primary sources before committing.`;
}

function keyFindings(response: DeepResearchResponse): string {
  if (!isGenericNoAnswer(response.answer)) return response.answer!.trim();
  if (response.results.length === 0)
    return "- No source-backed findings were returned.";
  return response.results
    .slice(0, 8)
    .map(
      (r, i) =>
        `- [${i + 1}] ${r.title ?? r.url ?? "Untitled"}: ${resultSnippet(r, 260) || "Review source directly."}`,
    )
    .join("\n");
}

function bulletSources(response: DeepResearchResponse): string {
  if (response.results.length === 0) return "- No source URLs returned by Exa.";
  return response.results
    .map(
      (r, i) =>
        `- [${i + 1}] ${r.title ?? r.url ?? "Untitled"}${r.url ? ` \u2014 ${r.url}` : ""}${r.publishedDate ? ` (${r.publishedDate})` : ""}`,
    )
    .join("\n");
}

export function renderFindingsReport(
  input: Pick<
    WebResearchInput,
    "query" | "reportTitle" | "researchMode" | "type"
  >,
  response: DeepResearchResponse,
  options: { rawOutputPath?: string } = {},
): string {
  const title = input.reportTitle || input.query;
  const structured = structuredOutputContent(response);

  const answer =
    typeof structured?.executiveSummary === "string"
      ? structured.executiveSummary.trim()
      : fallbackSummary(response);

  const findings = listMarkdown(
    structured?.keyFindings ?? structured?.findings,
    keyFindings(response),
  );

  const tradeoffs = listMarkdown(
    structured?.tradeoffs,
    "- Compare benefits against implementation cost, operational risk, and project-specific constraints before committing.\n- Prefer primary-source documentation and current release notes when evidence conflicts.",
  );

  const recommendation =
    typeof structured?.recommendation === "string" &&
    structured.recommendation.trim()
      ? structured.recommendation.trim()
      : answer;

  const risks = listMarkdown(
    structured?.risks,
    "- Verify source freshness and applicability to this project.\n- Re-run research if provider APIs, pricing, or release notes change.\n- Treat uncited or snippet-only claims as hypotheses until confirmed by primary sources.",
  );

  const revisit = listMarkdown(
    structured?.revisitConditions,
    "- New primary-source documentation contradicts these findings.\n- Implementation constraints differ from the context supplied to research.\n- Exa Deep Search returns materially different source coverage in a later run.",
  );

  const evidence = response.results
    .map((r, i) => {
      const snippet = resultSnippet(r, 1200);
      return `### [${i + 1}] ${r.title ?? r.url ?? "Untitled"}\n\n${r.url ?? ""}\n\n${snippet ? `> ${snippet}` : "> No snippet returned."}`;
    })
    .join("\n\n");

  const metadata = [
    `- Mode: ${response.metadata.researchMode ?? input.researchMode ?? "standard"}`,
    `- Exa type: ${response.metadata.type ?? input.type ?? "deep-reasoning"}`,
    `- Queries: ${response.metadata.queryCount ?? 1}`,
    `- Sources: ${response.metadata.uniqueSourceCount ?? response.results.length} unique${response.metadata.sourceCount && response.metadata.sourceCount !== response.results.length ? ` (${response.metadata.sourceCount} returned before dedupe)` : ""}`,
    options.rawOutputPath
      ? `- Raw metadata sidecar: ${options.rawOutputPath}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  return `# Findings: ${title}\n\n## Research Question\n\n${input.query}\n\n## Executive Summary\n\n${answer}\n\n## Key Findings\n\n${findings}\n\n## Evidence and Sources\n\n${bulletSources(response)}\n\n${evidence}\n\n## Tradeoffs / Alternatives\n\n${tradeoffs}\n\n## Recommendation / Decision Criteria\n\n${recommendation}\n\nUse the source evidence above as decision criteria; validate any project-specific assumptions before irreversible work.\n\n## Risks / Unknowns\n\n${risks}\n\n## Revisit Conditions\n\n${revisit}\n\n## Research Metadata\n\n${metadata}\n`;
}
