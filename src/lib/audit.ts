import "server-only";
import type { AuditAction, Prisma } from "@prisma/client";
import { clientIp, type CurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

type Tx = Prisma.TransactionClient | typeof prisma;

export interface AuditEntry {
  user: Pick<CurrentUser, "id" | "username"> | null;
  /** Uğursuz girişdə istifadəçi tapılmaya bilər — daxil edilən ad saxlanılır */
  username?: string;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  summary: string;
  changes?: Prisma.InputJsonValue;
}

/** Audit jurnalına qeyd; əməliyyatla eyni tranzaksiyada yazmaq üçün `tx` ötürülə bilər */
export async function audit(entry: AuditEntry, tx: Tx = prisma): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: entry.user?.id ?? null,
      username: entry.user?.username ?? entry.username ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary.slice(0, 500),
      changes: entry.changes,
      ip: await clientIp().catch(() => null),
    },
  });
}

const comparable = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v !== null && typeof v === "object" && "toNumber" in v) return Number(v); // Prisma.Decimal
  return v ?? null;
};

/** İki snapshot arasındakı fərq: { sahə: [əvvəl, sonra] } — yalnız dəyişən sahələr */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = comparable(before[key]);
    const b = comparable(after[key]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[key] = [a, b];
  }
  return out;
}

/** JSON-a yazıla bilən snapshot (Date → YYYY-MM-DD, Decimal → number) */
export function snapshot(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, comparable(v)]));
}
