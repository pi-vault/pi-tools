export interface TruncateResult {
  text: string;
  truncated: boolean;
  originalChars: number;
}

export function truncateContent(text: string, limit: number): TruncateResult {
  const originalChars = text.length;
  if (originalChars <= limit) {
    return { text, truncated: false, originalChars };
  }
  const notice = `\n\n[truncated] showing ${limit} of ${originalChars} chars`;
  const truncatedText = text.slice(0, limit - notice.length) + notice;
  return { text: truncatedText, truncated: true, originalChars };
}
