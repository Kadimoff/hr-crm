import type { ImportStage } from "@prisma/client";

export const STAGE_ORDER: ImportStage[] = [
  "S1_DEPARTMENTS",
  "S2_POSITIONS",
  "S3_STAFFING",
  "S4_PERSONS",
  "S5_EMPLOYMENTS",
  "S6_PROFILES",
  "S7_LEAVE_BALANCES",
  "S8_MOVEMENTS",
];

export const STAGE_LABELS: Record<ImportStage, string> = {
  S1_DEPARTMENTS: "Struktur bölmələri",
  S2_POSITIONS: "Vəzifələr kataloqu",
  S3_STAFFING: "Ştat cədvəli",
  S4_PERSONS: "Fiziki şəxslər",
  S5_EMPLOYMENTS: "Əmək müqavilələri",
  S6_PROFILES: "Paralel profillər",
  S7_LEAVE_BALANCES: "Məzuniyyət qalıqları",
  S8_MOVEMENTS: "Hərəkətlər (iştirak etməmə, xitam)",
};
