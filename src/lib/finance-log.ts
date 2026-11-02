// «server-only» YOX: idxal worker-i (tsx, react-server şərti olmadan) da istifadə edir
import type { FinanceField, FinanceSource, Prisma } from "@prisma/client";
import { num2 } from "./finance-history";

type Tx = Prisma.TransactionClient;

export interface FinanceChangeEntry {
  field: FinanceField;
  oldValue: string | null;
  newValue: string | null;
  oldLabel?: string | null;
  newLabel?: string | null;
}

export interface FinanceLogContext {
  personId: string;
  employmentId: string | null;
  effectiveDate: Date;
  source: FinanceSource;
  userId: string | null;
  orderNumber?: string | null;
  orderDate?: Date | null;
  movementId?: string | null;
}

/** Maliyyə tarixçəsinə yazır — yalnız həqiqətən dəyişən sahələr (köhnə ≠ yeni) */
export async function logFinanceChanges(tx: Tx, ctx: FinanceLogContext, entries: FinanceChangeEntry[]): Promise<number> {
  const data = entries
    .filter((e) => (e.oldValue ?? "") !== (e.newValue ?? ""))
    .map((e) => ({
      personId: ctx.personId,
      employmentId: ctx.employmentId,
      field: e.field,
      oldValue: e.oldValue,
      newValue: e.newValue,
      oldLabel: e.oldLabel ?? null,
      newLabel: e.newLabel ?? null,
      effectiveDate: ctx.effectiveDate,
      source: ctx.source,
      orderNumber: ctx.orderNumber ?? null,
      orderDate: ctx.orderDate ?? null,
      movementId: ctx.movementId ?? null,
      createdById: ctx.userId,
    }));
  if (data.length) await tx.financialChange.createMany({ data });
  return data.length;
}

/** Decimal / number / null → maşın dəyəri ("1500.00") */
export const moneyValue = (v: unknown): string | null => (v === null || v === undefined ? null : num2(v as number));
/** Zərərli şərait faizi: null — əlavə yoxdur */
export const pctValue = (v: unknown): string | null => (v === null || v === undefined ? null : String(Number(v)));

export const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
