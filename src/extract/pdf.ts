import { extractText, getDocumentProxy } from "unpdf";

export async function extractPdf(buffer: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(buffer);
  const { text } = await extractText(doc, { mergePages: true });
  return text.trim();
}
