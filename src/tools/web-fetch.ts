import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ContentStore } from "../storage.ts";
import { extractContent } from "../extract/pipeline.ts";
import { truncateContent } from "../utils/truncate.ts";
import { sanitizeError } from "../utils/errors.ts";

const INLINE_LIMIT = 15_000;

const WebFetchParams = Type.Object({
  url: Type.String({ description: "HTTP(S) URL to fetch" }),
});

interface WebFetchDetails {
  url: string;
  title?: string;
  chars: number;
  truncated: boolean;
  contentId?: string;
  extractionChain: string[];
}

export function createWebFetchTool(
  store: ContentStore,
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and extract readable content as markdown. Supports HTML, PDFs, and JS-rendered pages.",
    promptSnippet:
      "Fetch a URL and extract readable content as markdown. Supports HTML, PDFs, and JS-rendered pages.",
    promptGuidelines: [
      "Use web_fetch when you have a specific URL to read.",
      "For large pages, use web_read with the returned contentId to retrieve the full text.",
    ],
    parameters: WebFetchParams,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      try {
        const extracted = await extractContent(params.url, signal ?? undefined);

        let contentId: string | undefined;
        let outputText: string;
        let truncated = false;

        if (extracted.chars > INLINE_LIMIT) {
          contentId = store.store({
            url: extracted.url,
            title: extracted.title,
            text: extracted.text,
            source: "web_fetch",
          });
          const trunc = truncateContent(extracted.text, INLINE_LIMIT);
          outputText = trunc.text;
          truncated = true;
        } else {
          outputText = extracted.text;
        }

        const header = [
          extracted.title ? `# ${extracted.title}` : `# ${extracted.url}`,
          `Source: ${extracted.url}`,
          `Chars: ${extracted.chars}${truncated ? ` (truncated, use web_read with contentId "${contentId}" for full text)` : ""}`,
          "",
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: header + outputText }],
          details: {
            url: extracted.url,
            title: extracted.title,
            chars: extracted.chars,
            truncated,
            contentId,
            extractionChain: extracted.extractionChain,
          },
        };
      } catch (error) {
        const msg = sanitizeError(error);
        return {
          content: [{ type: "text" as const, text: `Fetch error: ${msg}` }],
          details: {
            url: params.url,
            chars: 0,
            truncated: false,
            extractionChain: [],
          },
        };
      }
    },
  };
}
