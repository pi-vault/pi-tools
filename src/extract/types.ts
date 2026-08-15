import type { PdfPageImage } from "./pdf-ocr.ts";

export interface VideoFrame {
  data: string;
  mimeType: string;
  timestamp: string;
}

export interface ExtractedContent {
  text: string;
  title?: string;
  url: string;
  extractionChain: string[];
  chars: number;
  truncated: boolean;
  contentId?: string;
  thumbnail?: { data: string; mimeType: string };
  frames?: VideoFrame[];
  images?: PdfPageImage[];
  duration?: number;
}

export type ImageBlock = { type: "image"; data: string; mimeType: string };

export function collectImageBlocks(extracted: ExtractedContent): ImageBlock[] {
  const blocks: ImageBlock[] = [];
  if (extracted.thumbnail) {
    blocks.push({
      type: "image",
      data: extracted.thumbnail.data,
      mimeType: extracted.thumbnail.mimeType,
    });
  }
  if (extracted.frames) {
    for (const frame of extracted.frames) {
      blocks.push({ type: "image", data: frame.data, mimeType: frame.mimeType });
    }
  }
  if (extracted.images) {
    for (const img of extracted.images) {
      blocks.push({ type: "image", data: img.data, mimeType: img.mimeType });
    }
  }
  return blocks;
}