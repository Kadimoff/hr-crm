import type { UserRole } from "@prisma/client";

/** Client komponentlərində də istifadə olunur — server-only deyil */
export const ROLE_LABELS: Record<UserRole, string> = {
  ROOT: "Administrator (root)",
  HR: "Kadr əməkdaşı",
  DEPT_HEAD: "Şöbə rəhbəri",
};

export type Permission =
  | "employees.view"
  | "employees.edit" // əlavə, redaktə, arxivə köçürmə, bərpa
  | "import"
  | "reports"
  | "users.manage"
  | "audit.view"
  | "structure.edit" // struktur bölmələrinin əlavəsi, redaktəsi, silinməsi
  | "database.manage" // backup, bərpa, bütün məlumatların silinməsi
  | "requests.manage" // sənəd silmə sorğularının təsdiqi / imtinası
  | "finance.history" // maliyyə tarixçəsi və «tarixə görə» maaş baxışı (şöbə rəhbərində yoxdur)
  | "charter.edit" // əsasnamə və vəzifə təlimatı qaralamaları, vəzifə kataloqu, tanışlıq qeydi
  | "charter.approve"; // əsasnamə / vəzifə təlimatının təsdiqi və qüvvədən salınması (ROOT; digərlərinə root bayraqla verir)

const GRANTS: Record<UserRole, Permission[]> = {
  ROOT: ["employees.view", "employees.edit", "structure.edit", "import", "reports", "users.manage", "audit.view", "database.manage", "requests.manage", "finance.history", "charter.edit", "charter.approve"],
  HR: ["employees.view", "employees.edit", "structure.edit", "import", "reports", "finance.history", "charter.edit"],
  DEPT_HEAD: ["employees.view", "reports"],
};

export function can(role: UserRole, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}

/** Şəxsi iş sənədini sorğusuz silmək: root və root-un icazə verdiyi istifadəçilər; digərləri sorğu göndərir */
export const canDeleteDocumentsDirectly = (user: { role: UserRole; canDeleteDocuments: boolean }) => user.role === "ROOT" || user.canDeleteDocuments;

/** Əsasnamə / vəzifə təlimatını təsdiq etmək: «charter.approve» (ROOT) və ya root-un icazə verdiyi hesab (HR) */
export const canApproveRegulations = (user: { role: UserRole; canApproveCharters: boolean }) => can(user.role, "charter.approve") || (user.role === "HR" && user.canApproveCharters);
