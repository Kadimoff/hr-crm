import type { RegulationStatus } from "@prisma/client";

/*
 * Əsasnamə (DepartmentCharter) və vəzifə təlimatı (JobDescription) üçün ümumi versiya / status qaydaları —
 * təmiz funksiyalar (server-only YOX: testlər və worker də işlədir).
 */

export const REGULATION_STATUS_LABELS: Record<RegulationStatus, string> = {
  QARALAMA: "Qaralama",
  HUQUQI_REYDE: "Hüquqi rəydə",
  TESDIQLENIB: "Təsdiqlənib",
  QUVVEDEN_DUSUB: "Qüvvədən düşüb",
};

export const REGULATION_STATUS_TONE: Record<RegulationStatus, "outline" | "warning" | "success" | "danger"> = {
  QARALAMA: "outline",
  HUQUQI_REYDE: "warning",
  TESDIQLENIB: "success",
  QUVVEDEN_DUSUB: "danger",
};

export class RegulationError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/** Mətn və fayl yalnız qaralamada və hüquqi rəydə dəyişdirilir; təsdiqlənmiş versiya dəyişməzdir (yeni versiya yaradılır) */
export const isEditable = (s: RegulationStatus) => s === "QARALAMA" || s === "HUQUQI_REYDE";

export function assertEditable(s: RegulationStatus): void {
  if (!isEditable(s))
    throw new RegulationError(
      s === "TESDIQLENIB" ? "Təsdiqlənmiş versiyanın mətni və faylı dəyişdirilə bilməz — «Yeni versiya» yaradın" : "Qüvvədən düşmüş versiya dəyişdirilə bilməz",
    );
}

/** İcazəli status keçidləri. approve — təsdiq hüququ (charter.approve) */
const TRANSITIONS: Record<RegulationStatus, RegulationStatus[]> = {
  QARALAMA: ["HUQUQI_REYDE", "TESDIQLENIB"],
  HUQUQI_REYDE: ["QARALAMA", "TESDIQLENIB"],
  TESDIQLENIB: ["QUVVEDEN_DUSUB"],
  QUVVEDEN_DUSUB: [],
};

export function transitionError(from: RegulationStatus, to: RegulationStatus, canApprove: boolean): string | null {
  if (!TRANSITIONS[from].includes(to)) return `«${REGULATION_STATUS_LABELS[from]}» statusundan «${REGULATION_STATUS_LABELS[to]}» statusuna keçid mümkün deyil`;
  if ((to === "TESDIQLENIB" || to === "QUVVEDEN_DUSUB") && !canApprove) return "Təsdiq və qüvvədən salma üçün xüsusi icazə lazımdır (root və ya «təsdiq edə bilər» hesabı)";
  return null;
}

export interface VersionRow {
  id: string;
  version: number;
  status: RegulationStatus;
  effectiveFrom: Date | null;
}

export const nextVersion = (rows: readonly Pick<VersionRow, "version">[]) => rows.reduce((m, r) => Math.max(m, r.version), 0) + 1;

/** Açıq (təsdiqlənməmiş) versiya — eyni anda yalnız biri olur */
export const openDraft = <T extends Pick<VersionRow, "status">>(rows: readonly T[]) => rows.find((r) => isEditable(r.status)) ?? null;

/** Qüvvədə olan versiya: təsdiqlənmişlərin ən yenisi */
export function inForce<T extends Pick<VersionRow, "status" | "version">>(rows: readonly T[]): T | null {
  return rows.filter((r) => r.status === "TESDIQLENIB").sort((a, b) => b.version - a.version)[0] ?? null;
}

const DAY = 86_400_000;

/**
 * Yeni versiya təsdiqlənəndə: əvvəlki qüvvədə olan versiya(lar) «Qüvvədən düşüb» olur, bitmə tarixi — yeni versiyanın
 * qüvvəyə minməsindən bir gün əvvəl (ən azı öz başlanğıcı). Qaytarılır: yenilənəcək qeydlər.
 */
export function supersede(rows: readonly VersionRow[], approvedId: string, effectiveFrom: Date): { id: string; effectiveTo: Date }[] {
  return rows
    .filter((r) => r.id !== approvedId && r.status === "TESDIQLENIB")
    .map((r) => {
      const end = new Date(effectiveFrom.getTime() - DAY);
      return { id: r.id, effectiveTo: r.effectiveFrom && end < r.effectiveFrom ? r.effectiveFrom : end };
    });
}

/** Baxış tarixi yaxınlaşanlar (default 30 gün) və keçmişlər */
export function reviewState(nextReviewOn: Date | null, today: Date, days = 30): "overdue" | "soon" | null {
  if (!nextReviewOn) return null;
  if (nextReviewOn < today) return "overdue";
  return nextReviewOn.getTime() - today.getTime() <= days * DAY ? "soon" : null;
}

// ----------------------------------------------------------------------------
//  Vəzifə təlimatı ilə tanışlıq (TZ M03-02)
// ----------------------------------------------------------------------------

export interface JdLite {
  id: string;
  positionId: string;
  departmentId: string | null;
  version: number;
  status: RegulationStatus;
}

export interface EmploymentLite {
  id: string;
  positionId: string;
  departmentId: string;
}

/** Müqavilə üçün tətbiq olunan qüvvədə təlimat: bölməyə xüsusi (vəzifə + bölmə) varsa o, yoxdursa vəzifə üzrə ümumi */
export function applicableJobDescription<T extends JdLite>(e: EmploymentLite, jds: readonly T[]): T | null {
  const approved = jds.filter((j) => j.status === "TESDIQLENIB" && j.positionId === e.positionId);
  const pick = (list: T[]) => list.sort((a, b) => b.version - a.version)[0] ?? null;
  return pick(approved.filter((j) => j.departmentId === e.departmentId)) ?? pick(approved.filter((j) => j.departmentId === null));
}

/**
 * Yeni təsdiqlənmiş təlimat üçün tanışlıq tapşırığı alacaq müqavilələr: həmin vəzifədə (departmentId verilibsə — həmin
 * bölmədə) aktiv müqaviləsi olan və bu təlimat onlara tətbiq olunan (bölməyə xüsusi təlimatı olanlar ümumi təlimatdan
 * tapşırıq almır). Artıq tapşırığı olanlar təkrarlanmır; köhnə versiyaların tanışlıqlarına toxunulmur.
 */
export function ackTargets<T extends JdLite>(approved: T, allJds: readonly T[], employments: readonly EmploymentLite[], existingAckEmploymentIds: ReadonlySet<string>): string[] {
  const jds = allJds.some((j) => j.id === approved.id) ? allJds.map((j) => (j.id === approved.id ? approved : j)) : [...allJds, approved];
  return employments
    .filter((e) => e.positionId === approved.positionId && (approved.departmentId === null || e.departmentId === approved.departmentId))
    .filter((e) => applicableJobDescription(e, jds)?.id === approved.id)
    .filter((e) => !existingAckEmploymentIds.has(e.id))
    .map((e) => e.id);
}
