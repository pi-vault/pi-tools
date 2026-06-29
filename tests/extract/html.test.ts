import { describe, expect, it } from "vitest";
import { extractHtml } from "../../src/extract/html.ts";

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
  <header><nav>Navigation</nav></header>
  <article>
    <h1>Main Article</h1>
    <p>This is the main content of the article. It has enough text to be considered
    meaningful content by Readability. The article discusses important topics that
    are relevant to the reader and provides valuable information about the subject
    matter at hand. We need sufficient content for Readability to consider this
    worth extracting.</p>
    <p>Another paragraph with more details about the topic. This adds depth to the
    article and ensures that the content meets the minimum threshold for extraction.
    Additional context helps the reader understand the full picture.</p>
    <table>
      <tr><th>Name</th><th>Value</th></tr>
      <tr><td>Alpha</td><td>100</td></tr>
    </table>
  </article>
  <script>alert('ignored')</script>
  <footer>Footer content</footer>
</body>
</html>`;

describe("extractHtml", () => {
  it("extracts article content as markdown", () => {
    const result = extractHtml(SAMPLE_HTML, "https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Main Article");
    expect(result!.text).toContain("main content");
  });

  it("strips script and style tags", () => {
    const result = extractHtml(SAMPLE_HTML, "https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.text).not.toContain("alert");
  });

  it("preserves tables as GFM markdown", () => {
    const result = extractHtml(SAMPLE_HTML, "https://example.com/article");
    expect(result).not.toBeNull();
    // GFM tables use pipe characters
    expect(result!.text).toContain("|");
    expect(result!.text).toContain("Alpha");
  });

  it("includes title when available", () => {
    const result = extractHtml(SAMPLE_HTML, "https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.title).toBeDefined();
  });

  it("returns null for content too short to be useful", () => {
    const thinHtml = "<html><body><p>Hi</p></body></html>";
    const result = extractHtml(thinHtml, "https://example.com");
    expect(result).toBeNull();
  });
});
