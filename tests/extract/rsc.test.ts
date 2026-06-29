import { describe, expect, it } from "vitest";
import { extractRsc } from "../../src/extract/rsc.ts";

describe("extractRsc", () => {
  it("detects and extracts RSC content", () => {
    const html = `
    <html><body>
    <script>self.__next_f.push([1,"0:[\\"$\\",\\"div\\",null,{\\"children\\":\\"Hello RSC World\\"}]"])</script>
    <script>self.__next_f.push([1,"More RSC content here with actual text about the topic that is long enough to be useful content for extraction purposes. This additional sentence ensures the combined extracted text meets the minimum content threshold."])</script>
    </body></html>`;

    const result = extractRsc(html);
    expect(result).not.toBeNull();
    expect(result).toContain("Hello RSC World");
  });

  it("returns null for non-RSC pages", () => {
    const html = "<html><body><p>Normal page</p></body></html>";
    expect(extractRsc(html)).toBeNull();
  });

  it("returns null when extracted content is too short", () => {
    const html = `<html><body>
    <script>self.__next_f.push([1,"x"])</script>
    </body></html>`;
    expect(extractRsc(html)).toBeNull();
  });
});
