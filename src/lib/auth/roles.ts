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
  | "requests.manage"; // sənəd silmə sorğularının təsdiqi / imtinası

const GRANTS: Record<UserRole, Permission[]> = {
  ROOT: ["employees.view", "employees.edit", "structure.edit", "import", "reports", "users.manage", "audit.view", "database.manage", "requests.manage"],
  HR: ["employees.view", "employees.edit", "structure.edit", "import", "reports"],
  DEPT_HEAD: ["employees.view", "reports"],
};

export function can(role: UserRole, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}

/** Şəxsi iş sənədini sorğusuz silmək: root və root-un icazə verdiyi istifadəçilər; digərləri sorğu göndərir */
export const canDeleteDocumentsDirectly = (user: { role: UserRole; canDeleteDocuments: boolean }) => user.role === "ROOT" || user.canDeleteDocuments;
