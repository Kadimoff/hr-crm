import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { hiddenSalaryIds, lockedSalaryIds, salaryAccess } from "@/lib/salary-restriction";
import type { CurrentUser } from "./session";

/**
 * Cari istifadəçidən maaşı gizlədilən şəxslər — bir sorğu ərzində keşlənir (React cache: açar istifadəçi obyekti
 * deyil, id + bayraqlardır; sorğular arası paylaşılmır — root-un nəticəsi başqasına keçmir).
 */
const hiddenCached = cache((userId: string, role: CurrentUser["role"], personId: string | null, flag: boolean) =>
  hiddenSalaryIds(prisma, { role, personId, canViewRestrictedSalaries: flag }),
);

export const hiddenSalaryPersonIds = (user: CurrentUser): Promise<Set<string>> => hiddenCached(user.id, user.role, user.personId, user.canViewRestrictedSalaries);

export const lockedSalaryPersonIds = (user: CurrentUser): Promise<Set<string>> => lockedSalaryIds(prisma, user);

export const salaryAccessFor = (user: CurrentUser, personId: string) => salaryAccess(prisma, user, personId);
