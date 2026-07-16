// src/extract/pdf-ocr.ts
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getVersionedApiBase, DEFAULT_MODEL } from "./gemini-api.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RasterizeOptions {
  maxPages?: number; // default: 5, max: 20
  dpi?: number; // default: 150, range: 72-300
}

export interface PdfPageImage {
  type: "image";
  mimeType: "image/png";
  data: string; // base64-encoded PNG
  pageNumber: number;
}

export interface RasterizeResult {
  pageCount: number;
  images: PdfPageImage[];
  truncated: boolean; // true if pageCount > maxPages
}

// ---------------------------------------------------------------------------
// Scanned PDF Heuristic
// ---------------------------------------------------------------------------

/**
 * Determine whether a PDF is likely a scanned/image-based document.
 *
 * Returns true when:
 * - Extracted text is empty after whitespace normalization, OR
 * - PDF byte size > 5000 AND trimmed text < 200 characters
 */
export function looksLikeScannedPdf(text: string, byteLength: number): boolean {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return true;
  if (byteLength > 5000 && trimmed.length < 200) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Model Vision Detection
// ---------------------------------------------------------------------------

/**
 * Check whether the calling model supports image input.
 * Uses Pi's Model interface: `ctx.model?.input` is an array of
 * `("text" | "image")[]`.
 */
export function modelSupportsImages(ctx: ExtensionContext): boolean {
  return (ctx.model as any)?.input?.includes("image") ?? false;
}

// ---------------------------------------------------------------------------
// Page Count Detection (pdfinfo CLI)
// ---------------------------------------------------------------------------

/**
 * Read the total page count from a PDF file using `pdfinfo` (poppler-utils).
 * Returns undefined if pdfinfo is not installed or fails.
 */
function readPageCount(pdfPath: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile("pdfinfo", [pdfPath], { timeout: 5_000 }, (err, stdout) => {
      if (err) {
        resolve(undefined);
        return;
      }
      const match = String(stdout ?? "").match(/^Pages:\s*(\d+)/m);
      resolve(match?.[1] ? Number(match[1]) : undefined);
    });
  });
}

// ---------------------------------------------------------------------------
// PDF Rasterization (pdftoppm CLI)
// ---------------------------------------------------------------------------

/**
 * Rasterize PDF pages to PNG using `pdftoppm` from poppler-utils.
 *
 * Writes the PDF buffer to a temp directory, runs pdftoppm, reads
 * output PNGs as base64, and cleans up the temp directory.
 *
 * Uses `pdfinfo` (when available) to get the real page count so the
 * `truncated` flag and `pageCount` in the result are accurate.
 *
 * @throws Error if pdftoppm is not installed or rasterization fails
 */
export async function rasterizePdfPages(
  pdfBuffer: Uint8Array,
  options?: RasterizeOptions,
): Promise<RasterizeResult> {
  const maxPages = Math.min(Math.max(1, options?.maxPages ?? 5), 20);
  const dpi = Math.min(Math.max(72, options?.dpi ?? 150), 300);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pdf-ocr-"));
  const pdfPath = path.join(tmpDir, "input.pdf");
  const outputPrefix = path.join(tmpDir, "page");

  try {
    fs.writeFileSync(pdfPath, pdfBuffer);

    // Get real page count before rasterizing (best-effort)
    const totalPages = await readPageCount(pdfPath);
    const lastPage = Math.min(totalPages ?? maxPages, maxPages);

    await new Promise<void>((resolve, reject) => {
      execFile(
        "pdftoppm",
        [
          "-png",
          "-r", String(dpi),
          "-f", "1",
          "-l", String(lastPage),
          pdfPath,
          outputPrefix,
        ],
        { timeout: 30_000 },
        (err, _stdout, stderr) => {
          if (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === "ENOENT") {
              reject(new Error(
                "pdftoppm not found. Install poppler-utils for PDF OCR:\n" +
                "  macOS: brew install poppler\n" +
                "  Ubuntu/Debian: apt-get install poppler-utils",
              ));
            } else {
              reject(new Error(`pdftoppm failed: ${stderr || err.message}`));
            }
            return;
          }
          resolve();
        },
      );
    });

    // Read generated PNG files (pdftoppm names them page-01.png, page-02.png, etc.)
    const files = fs.readdirSync(tmpDir)
      .filter((f) => f.startsWith("page") && f.endsWith(".png"))
      .sort();

    const images: PdfPageImage[] = files.map((file) => {
      const match = file.match(/^page-(\d+)\.png$/);
      const data = fs.readFileSync(path.join(tmpDir, file));
      return {
        type: "image" as const,
        mimeType: "image/png" as const,
        data: data.toString("base64"),
        pageNumber: match ? Number(match[1]) : files.indexOf(file) + 1,
      };
    });

    const pageCount = totalPages ?? images.length;
    const truncated = pageCount > lastPage;

    return { pageCount, images, truncated };
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// Gemini Vision OCR
// ---------------------------------------------------------------------------

/**
 * Extract text from PDF page images using Gemini's vision capability.
 * Returns the OCR'd text, or null if the API call fails.
 */
export async function extractTextWithGeminiVision(
  images: PdfPageImage[],
  geminiApiKey: string,
  options?: { geminiBaseUrl?: string; model?: string },
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const model = options?.model ?? DEFAULT_MODEL;
    const baseUrl = options?.geminiBaseUrl
      ? `${options.geminiBaseUrl.replace(/\/+$/, "")}/v1beta`
      : getVersionedApiBase();
    const url = `${baseUrl}/models/${model}:generateContent?key=${geminiApiKey}`;

    // Build parts: one inline_data per page image, then the text prompt
    const parts: Array<Record<string, unknown>> = images.map((img) => ({
      inline_data: {
        mime_type: img.mimeType,
        data: img.data,
      },
    }));

    parts.push({
      text:
        "Extract all text from these scanned PDF page images. " +
        "Preserve the original layout, headings, paragraphs, and any table structure. " +
        "Return only the extracted text, no commentary.",
    });

    const body = {
      contents: [{ role: "user", parts }],
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("\n");

    return text || null;
  } catch {
    return null;
  }
}
