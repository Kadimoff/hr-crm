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
  | "database.manage"; // backup, bərpa, bütün məlumatların silinməsi

const GRANTS: Record<UserRole, Permission[]> = {
  ROOT: ["employees.view", "employees.edit", "import", "reports", "users.manage", "audit.view", "database.manage"],
  HR: ["employees.view", "employees.edit", "import", "reports"],
  DEPT_HEAD: ["employees.view", "reports"],
};

export function can(role: UserRole, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}
