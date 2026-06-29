import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";

const MIN_CONTENT_LENGTH = 500;

export interface HtmlExtractResult {
  text: string;
  title?: string;
}

export function extractHtml(
  html: string,
  _url: string,
): HtmlExtractResult | null {
  const { document } = parseHTML(html);

  // Strip non-content elements
  for (const tag of ["script", "style", "noscript"]) {
    for (const el of document.querySelectorAll(tag)) {
      el.remove();
    }
  }

  // Run Readability
  const reader = new Readability(document);
  const article = reader.parse();

  if (!article || !article.content) return null;

  // Convert HTML to Markdown
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  turndown.use(gfm);
  let markdown = turndown.turndown(article.content);

  // Normalize whitespace
  markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();

  if (markdown.length < MIN_CONTENT_LENGTH) return null;

  return {
    text: markdown,
    title: article.title || undefined,
  };
}
