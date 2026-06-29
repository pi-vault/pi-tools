const RSC_MARKER = "self.__next_f.push";
const MIN_CONTENT_LENGTH = 200;

export function extractRsc(html: string): string | null {
  if (!html.includes(RSC_MARKER)) return null;

  const chunks: string[] = [];
  const pattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let match = pattern.exec(html);

  while (match !== null) {
    try {
      const decoded = match[1]
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .replace(/\\n/g, "\n");
      chunks.push(decoded);
    } catch {
      // Skip malformed chunks
    }
    match = pattern.exec(html);
  }

  if (chunks.length === 0) return null;

  const combined = chunks.join("\n");

  // Strip RSC protocol markers and extract readable text
  const text = combined
    .replace(/\$[A-Za-z0-9]+/g, "") // Remove RSC references
    .replace(/\["[^"]*",/g, "") // Remove component markers
    .replace(/[{}[\]]/g, " ") // Remove JSON structure
    .replace(/\\u[0-9a-fA-F]{4}/g, "") // Remove unicode escapes
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < MIN_CONTENT_LENGTH) return null;

  return text;
}
