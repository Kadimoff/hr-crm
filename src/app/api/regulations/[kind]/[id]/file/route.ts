import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { documentType, extensionOf, MAX_DOCUMENT_BYTES } from "@/lib/document-types";
import { contentDisposition, matchesSignature } from "@/lib/documents";
import { REGULATION_TITLES, type RegulationKind } from "@/lib/regulation-fields";
import { delegate, ENTITY, readRegulationFile, removeRegulationFile, saveRegulationFile } from "@/lib/regulation-store";
import { isEditable } from "@/lib/regulations";

export const runtime = "nodejs";

const kindOf = (k: string): RegulationKind | null => (k === "charter" || k === "jd" ? k : null);

/** İmzalı faylın (PDF / skan / Word) yüklənməsi */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await apiUser("employees.view");
  if (user instanceof Response) return user;
  const { kind: k, id } = await params;
  const kind = kindOf(k);
  if (!kind) return NextResponse.json({ error: "Tapılmadı" }, { status: 404 });
  const row = await delegate(prisma, kind).findUnique({ where: { id } });
  if (!row?.fileStoragePath) return NextResponse.json({ error: "Fayl yoxdur" }, { status: 404 });
  const buf = await readRegulationFile(row.fileStoragePath);
  if (!buf) return NextResponse.json({ error: "Fayl tapılmadı" }, { status: 404 });
  const t = documentType(row.fileExtension ?? "");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": t?.mime ?? "application/octet-stream",
      "Content-Disposition": contentDisposition(t?.view === "file" ? "inline" : "attachment", row.fileName ?? `${id}.${row.fileExtension}`),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Fayl əlavə et / əvəz et: qaralama və hüquqi rəydə — istənilən vaxt; təsdiqlənmiş versiyaya imzalı nüsxə yalnız bir dəfə
 * (fayl yoxdursa) — mövcud fayl dəyişdirilmir (təsdiqlənmiş sənəd dəyişməzdir).
 */
export async function POST(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await apiUser("charter.edit");
  if (user instanceof Response) return user;
  const { kind: k, id } = await params;
  const kind = kindOf(k);
  if (!kind) return NextResponse.json({ error: "Tapılmadı" }, { status: 404 });
  const d = delegate(prisma, kind);
  const row = await d.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Sənəd tapılmadı" }, { status: 404 });
  if (!isEditable(row.status) && !(row.status === "TESDIQLENIB" && !row.fileStoragePath))
    return NextResponse.json({ error: "Təsdiqlənmiş versiyanın faylı dəyişdirilə bilməz — yeni versiya yaradın" }, { status: 409 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Fayl seçilməyib" }, { status: 400 });
  const ext = extensionOf(file.name);
  if (!ext || !["pdf", "jpg", "jpeg", "png", "docx", "doc", "tif", "tiff"].includes(ext)) return NextResponse.json({ error: "PDF, şəkil və ya Word faylı seçin" }, { status: 400 });
  if (file.size > MAX_DOCUMENT_BYTES) return NextResponse.json({ error: "Fayl 30 MB-dan böyükdür" }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  if (!matchesSignature(ext, buf)) return NextResponse.json({ error: "Faylın məzmunu uzantısına uyğun gəlmir" }, { status: 400 });
  const storagePath = await saveRegulationFile(kind, id, ext, buf);
  if (row.fileStoragePath && row.fileStoragePath !== storagePath) await removeRegulationFile(row.fileStoragePath);
  await d.update({ where: { id }, data: { fileName: file.name.slice(0, 255), fileExtension: ext, fileSize: file.size, fileStoragePath: storagePath } });
  await audit({ user, action: "UPDATE", entity: ENTITY[kind], entityId: id, summary: `${REGULATION_TITLES[kind].one} v${row.version}: fayl əlavə edildi — ${file.name}` });
  return NextResponse.json({ ok: true });
}
