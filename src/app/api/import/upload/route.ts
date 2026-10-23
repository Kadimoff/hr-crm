import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enqueueImport } from "@/lib/queue";
import { detectTemplateByName, TEMPLATES } from "@/lib/validation/templates";
import type { TemplateKey } from "@/lib/validation/types";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./storage/uploads");

export async function POST(request: Request) {
  const user = await apiUser("import");
  if (user instanceof Response) return user;
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "Fayl seçilməyib" }, { status: 400 });

  // İstifadəçi şablonu əl ilə seçibsə: template:<faylın adı> = <açar>
  const resolved: { file: File; templateKey: TemplateKey }[] = [];
  const rejected: { name: string; reason: string }[] = [];
  for (const file of files) {
    const override = form.get(`template:${file.name}`);
    const key = (typeof override === "string" && override in TEMPLATES ? override : detectTemplateByName(file.name)) as TemplateKey | null;
    if (!file.name.toLowerCase().endsWith(".xlsx")) rejected.push({ name: file.name, reason: "Yalnız .xlsx faylları qəbul olunur" });
    else if (file.size > MAX_FILE_BYTES) rejected.push({ name: file.name, reason: "Fayl 50 MB-dan böyükdür" });
    else if (!key) rejected.push({ name: file.name, reason: "Şablon təyin edilmədi — fayl adı 1–10 nömrə ilə başlamalıdır" });
    else resolved.push({ file, templateKey: key });
  }
  if (resolved.length === 0) return NextResponse.json({ error: "Qəbul olunan fayl yoxdur", rejected }, { status: 400 });

  const batch = await prisma.importBatch.create({ data: { createdBy: user.id } });
  const dir = path.join(UPLOAD_DIR, batch.id);
  await mkdir(dir, { recursive: true });

  for (const { file, templateKey } of resolved) {
    // Fayl adını təhlükəsiz edirik (path traversal)
    const safeName = path.basename(file.name).replace(/[^\p{L}\p{N}._ -]/gu, "_");
    const storagePath = path.join(dir, `${TEMPLATES[templateKey].number}-${safeName}`);
    await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));
    await prisma.importFile.create({ data: { batchId: batch.id, templateKey, fileName: file.name, storagePath } });
  }

  await enqueueImport({ kind: "validate", batchId: batch.id });
  await audit({ user, action: "IMPORT", entity: "ImportBatch", entityId: batch.id, summary: `Excel faylları yükləndi: ${resolved.map((r) => r.file.name).join(", ")}` });
  return NextResponse.json({ batchId: batch.id, rejected });
}
