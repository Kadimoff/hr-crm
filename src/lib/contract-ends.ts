import "server-only";
import { prisma } from "@/lib/db";
import { bucketOf } from "@/lib/contract-rules";

export { DEFAULT_THRESHOLDS, parseThresholds } from "@/lib/contract-rules";

export interface ContractEndRow {
  employmentId: string;
  personId: string;
  code: string;
  fullName: string;
  department: string;
  position: string;
  isPrimary: boolean;
  hireDate: Date | null;
  endDate: Date;
  daysLeft: number;
  bucket: number | "overdue";
  owner: string | null;
  decision: string | null;
}

/** Müddətli müqavilələrin sonu (TZ M05-03): aktiv müqavilələr, bitmə tarixi ən böyük həddən yaxın olanlar və keçənlər */
export async function getContractEnds(scope: string[] | null, thresholds: number[]): Promise<ContractEndRow[]> {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const max = Math.max(...thresholds);
  const until = new Date(today.getTime() + max * 86_400_000);
  const rows = await prisma.employment.findMany({
    where: { status: { not: "TERMINATED" }, contractEndDate: { not: null, lte: until }, person: { deletedAt: null }, ...(scope ? { departmentId: { in: scope } } : {}) },
    orderBy: { contractEndDate: "asc" },
    include: { person: { select: { id: true, code: true, fullName: true } }, department: { select: { name: true } }, position: { select: { name: true } } },
  });
  return rows.flatMap((e) => {
    const daysLeft = Math.round((e.contractEndDate!.getTime() - today.getTime()) / 86_400_000);
    const bucket = bucketOf(daysLeft, thresholds);
    if (bucket === null) return [];
    return [
      {
        employmentId: e.id,
        personId: e.person.id,
        code: e.person.code,
        fullName: e.person.fullName,
        department: e.department.name,
        position: e.position.name,
        isPrimary: e.isPrimary,
        hireDate: e.hireDate,
        endDate: e.contractEndDate!,
        daysLeft,
        bucket,
        owner: e.contractEndOwner,
        decision: e.contractEndNote,
      },
    ];
  });
}
