import { extractText, getDocumentProxy } from "unpdf";

export async function extractPdf(
  buffer: Uint8Array,
  maxPages = 100,
): Promise<string> {
  const doc = await getDocumentProxy(buffer);
  const totalPages = Math.min(doc.numPages, maxPages);
  const { text } = await extractText(doc, { mergePages: true });
  return text.trim();
}
