import type { DocumentKind } from "@prisma/client";

/** «Şəxsi iş» sənədlərinin növləri — sıra menyudakı sıradır */
export const DOCUMENT_KINDS: Record<DocumentKind, string> = {
  EMR: "Əmrlər",
  MUQAVILE: "Müqavilələr",
  SEXSIYYET: "Şəxsiyyət sənədləri",
  TEHSIL: "Təhsil sənədləri",
  ARAYIS: "Arayışlar",
  DIGER: "Digər",
};

/**
 * Qəbul olunan fayllar. view — brauzerdə necə açılır:
 * file — PDF və şəkil olduğu kimi; html — Word/Excel serverdə HTML-ə çevrilir; null — yalnız yükləmə.
 */
export const DOCUMENT_TYPES = {
  pdf: { mime: "application/pdf", view: "file", label: "PDF" },
  jpg: { mime: "image/jpeg", view: "file", label: "Şəkil" },
  jpeg: { mime: "image/jpeg", view: "file", label: "Şəkil" },
  png: { mime: "image/png", view: "file", label: "Şəkil" },
  webp: { mime: "image/webp", view: "file", label: "Şəkil" },
  tif: { mime: "image/tiff", view: null, label: "TIFF skan" },
  tiff: { mime: "image/tiff", view: null, label: "TIFF skan" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", view: "html", label: "Word" },
  doc: { mime: "application/msword", view: null, label: "Word" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", view: "html", label: "Excel" },
  xls: { mime: "application/vnd.ms-excel", view: null, label: "Excel" },
} as const satisfies Record<string, { mime: string; view: "file" | "html" | null; label: string }>;

export type DocumentExtension = keyof typeof DOCUMENT_TYPES;

export const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;

/** <input accept> üçün */
export const DOCUMENT_ACCEPT = Object.keys(DOCUMENT_TYPES)
  .map((e) => `.${e}`)
  .join(",");

export const extensionOf = (fileName: string): DocumentExtension | null => {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ext in DOCUMENT_TYPES ? (ext as DocumentExtension) : null;
};

export const documentType = (ext: string) => DOCUMENT_TYPES[ext as DocumentExtension] ?? null;
