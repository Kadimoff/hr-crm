import type { ZodIssue } from "zod";
import type { FieldIssue, RawRow, RefContext, SheetDef } from "./types";

/*
 * Təmiz funksiya — həm worker-də, həm də brauzerdə (redaktə zamanı ani yoxlama) istifadə olunur.
 */

function zodTier(issue: ZodIssue): FieldIssue["tier"] {
  const params = (issue as ZodIssue & { params?: { tier?: string } }).params;
  return params?.tier === "semantic" ? "semantic" : "syntactic";
}

export interface RowResult {
  parsed: unknown | null;
  issues: FieldIssue[];
}

/** Bir sətri 3 səviyyədə yoxlayır: sintaktik (Zod) → semantik → istinad */
export function validateRow(def: SheetDef, raw: RawRow, ctx: RefContext, rowNumber: number): RowResult {
  const result = def.schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map<FieldIssue>((i) => ({
      field: String(i.path[0] ?? "*"),
      tier: zodTier(i),
      severity: "error",
      message: i.message,
    }));
    return { parsed: null, issues };
  }
  const parsed = result.data;
  const issues: FieldIssue[] = [...(def.semantic?.(parsed, raw) ?? []), ...(def.references?.(parsed, ctx, rowNumber) ?? [])];
  return { parsed, issues };
}


/** Yalnız sintaktik + semantik yoxlama (istinadlar serverdə yoxlanılır) — redaktə edilən xana üçün ani cavab */
export function validateLocal(def: SheetDef, raw: RawRow): FieldIssue[] {
  const result = def.schema.safeParse(raw);
  if (!result.success) {
    return result.error.issues.map((i) => ({ field: String(i.path[0] ?? "*"), tier: zodTier(i), severity: "error", message: i.message }));
  }
  return def.semantic?.(result.data, raw) ?? [];
}
