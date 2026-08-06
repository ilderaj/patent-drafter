import type { SourceAsset, SourceChunk } from "@patent/domain";

export type ParsedFileKind = "doc" | "docx" | "pdf" | "text" | "markdown" | "png" | "jpeg";

export interface ParseLimits {
  maxBytes: number;
  maxPages: number;
  maxChunks: number;
  maxZipRatio: number;
}

export interface ParseResult {
  asset: SourceAsset;
  chunks: SourceChunk[];
  warnings: string[];
  /** true when OCR was applied (scanned PDF / image input). */
  ocrApplied: boolean;
}

export interface Parser {
  kind: ParsedFileKind;
  /** Returns parse result or a typed rejection reason; never throws for malicious input. */
  parse(buffer: ArrayBuffer, meta: { fileName: string; limits: ParseLimits }): Promise<ParseResult | ParseRejection>;
}

export interface ParseRejection {
  reason:
    | "TOO_LARGE"
    | "ZIP_BOMB"
    | "UNSUPPORTED_TYPE"
    | "MACRO_OR_SCRIPT_DETECTED"
    | "PATH_TRAVERSAL"
    | "PARSE_FAILED";
  message: string;
}

export const DEFAULT_LIMITS: ParseLimits = {
  maxBytes: 50 * 1024 * 1024,
  maxPages: 300,
  maxChunks: 20_000,
  maxZipRatio: 200,
};

/** OCR contract (macOS Vision spike verified; Bridge implements). */
export interface OcrEngine {
  recognize(imageBytes: ArrayBuffer, languages: string[]): Promise<Array<{ text: string; confidence: number; bbox: [number, number, number, number] }>>;
}
