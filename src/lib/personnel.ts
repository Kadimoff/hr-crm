import type { Prisma } from "@prisma/client";

/**
 * Menyuda heyət bölməsinin altında göstərilən struktur vahidləri (alt bölmələri ilə birlikdə).
 * faculties — fakültələr; admin — fakültə olmayan 1-ci səviyyə bölmələrin (Rektorluq) içindəkilər.
 */
export const UNIT_GROUPS = {
  faculties: { isFaculty: true },
  admin: { parent: { is: { parentId: null, isFaculty: false } } },
} satisfies Record<string, Prisma.DepartmentWhereInput>;

export type UnitGroup = keyof typeof UNIT_GROUPS;

/**
 * «Şəxsi iş» menyusunun bölmələri — aktiv iş yerindəki vəzifəyə görə (əvəzçiliklə iki bölmədə ola bilər).
 * Rəhbərlik: vəzifədə «inzibati idarəetmə personalı» işarəsi olanlar; digər bölmələrə düşmürlər.
 */
export const PERSONNEL_CATEGORIES = [
  { slug: "akademik", label: "Akademik heyət", description: "Professor-müəllim heyəti", units: "faculties", where: { staffCategory: "PROFESSOR_MUELLIM", isAdministrativeManagement: false } },
  { slug: "inzibati", label: "İnzibati heyət", description: "İnzibati heyət", units: "admin", where: { staffCategory: "INZIBATI", isAdministrativeManagement: false } },
  { slug: "tedris-komekci", label: "Tədris-köməkçi heyət", description: "Laborant, metodist və s.", units: null, where: { staffCategory: "TEDRIS_KOMEKCI", isAdministrativeManagement: false } },
  { slug: "rehberlik", label: "Rəhbərlik", description: "İnzibati idarəetmə personalı", units: null, where: { isAdministrativeManagement: true } },
  { slug: "texniki", label: "Texniki heyət", description: "Xidmətedici heyət", units: null, where: { staffCategory: "XIDMETEDICI", isAdministrativeManagement: false } },
] as const satisfies readonly { slug: string; label: string; description: string; units: UnitGroup | null; where: Prisma.PositionWhereInput }[];

export type PersonnelCategory = (typeof PERSONNEL_CATEGORIES)[number];

export const PERSONNEL_HREF = "/personnel";

export const personnelCategory = (slug: string) => PERSONNEL_CATEGORIES.find((c) => c.slug === slug);

/** Menyu ağacı: 1-ci səviyyə vahid və onun alt bölmələri */
export type UnitNode = { id: string; name: string; children: { id: string; name: string }[] };

/** /personnel/<bölmə>/<vahid id> səhifəsinin vahidi: ağacda tapılır, alt bölmədirsə valideyni ilə */
export function findUnit(nodes: UnitNode[], id: string) {
  for (const node of nodes) {
    if (node.id === id) return { node, child: undefined };
    const child = node.children.find((c) => c.id === id);
    if (child) return { node, child };
  }
  return undefined;
}
