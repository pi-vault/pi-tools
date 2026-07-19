export type ExaDeepType = "deep-reasoning" | "deep-lite" | "deep";

export type ResearchMode = "lite" | "standard" | "full";

export type ReportFormat = "findings" | "markdown" | "json";

export interface DeepResearchParams {
  query: string;
  type: ExaDeepType;
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
  additionalQueries?: string[];
  systemPrompt?: string;
  outputSchema?: Record<string, unknown>;
}

export interface DeepResearchResult {
  title?: string;
  url?: string;
  text?: string;
  summary?: string;
  highlights?: string[];
  publishedDate?: string;
}

export interface DeepResearchResponse {
  answer?: string;
  results: DeepResearchResult[];
  raw: unknown;
  metadata: Record<string, unknown>;
}

export interface ResearchModeDefaults {
  type: ExaDeepType;
  numResults: number;
  textMaxCharacters: number;
  timeoutSeconds: number;
  highlightsMaxCharacters: number;
  highlightNumSentences: number;
  highlightsPerUrl: number;
  summaryQuery?: string;
  maxAgeHours?: number;
  category?: string;
  outputSchema?: Record<string, unknown>;
}

export const defaultResearchOutputSchema = {
  type: "object" as const,
  required: ["executiveSummary", "keyFindings", "recommendation", "risks", "revisitConditions"],
  properties: {
    executiveSummary: {
      type: "string",
      description: "Concise source-grounded summary.",
    },
    keyFindings: {
      type: "array",
      items: { type: "string" },
      description: "Important findings with specifics.",
    },
    tradeoffs: {
      type: "array",
      items: { type: "string" },
      description: "Tradeoffs and alternatives.",
    },
    recommendation: {
      type: "string",
      description: "Recommended decision or criteria.",
    },
    risks: {
      type: "array",
      items: { type: "string" },
      description: "Known risks or uncertainties.",
    },
    revisitConditions: {
      type: "array",
      items: { type: "string" },
      description: "Conditions that trigger re-research.",
    },
  },
};

export const researchModeDefaults: Record<ResearchMode, ResearchModeDefaults> = {
  lite: {
    type: "deep-lite",
    numResults: 15,
    textMaxCharacters: 10000,
    timeoutSeconds: 300,
    highlightsMaxCharacters: 600,
    highlightNumSentences: 3,
    highlightsPerUrl: 1,
  },
  standard: {
    type: "deep-reasoning",
    numResults: 50,
    textMaxCharacters: 16000,
    timeoutSeconds: 600,
    highlightsMaxCharacters: 900,
    highlightNumSentences: 4,
    highlightsPerUrl: 2,
    summaryQuery:
      "Summarize the source evidence relevant to the research question, preserving concrete facts and tradeoffs.",
    outputSchema: defaultResearchOutputSchema,
  },
  full: {
    type: "deep-reasoning",
    numResults: 100,
    textMaxCharacters: 24000,
    timeoutSeconds: 1800,
    highlightsMaxCharacters: 1200,
    highlightNumSentences: 5,
    highlightsPerUrl: 3,
    summaryQuery:
      "Summarize the source evidence relevant to the research question, emphasizing decision criteria, tradeoffs, risks, and revisit triggers.",
    outputSchema: defaultResearchOutputSchema,
  },
};
