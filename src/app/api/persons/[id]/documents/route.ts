import { randomUUID } from "node:crypto";
import type { DocumentKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { canAccessPerson } from "@/lib/auth/scope";
import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { DOCUMENT_KINDS, extensionOf, MAX_DOCUMENT_BYTES } from "@/lib/document-types";
import { matchesSignature, removeDocumentFile, saveDocumentFile } from "@/lib/documents";

export const runtime = "nodejs";

const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null;
};

/** Şəxsi işə sənəd(lər) əlavə etmək: files[], kind? (yoxdursa Digər), title?, number?, date? (YYYY-MM-DD, yoxdursa bu gün) */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser("employees.edit");
  if (user instanceof Response) return user;
  const { id: personId } = await params;
  const person = await prisma.person.findFirst({ where: { id: personId, deletedAt: null }, select: { fullName: true, code: true } });
  if (!person || !(await canAccessPerson(user, personId))) return NextResponse.json({ error: "Əməkdaş tapılmadı" }, { status: 404 });

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const kind = (field(form, "kind") ?? "DIGER") as DocumentKind;
  if (!(kind in DOCUMENT_KINDS)) return NextResponse.json({ error: "Sənədin növü düzgün deyil" }, { status: 400 });
  if (files.length === 0) return NextResponse.json({ error: "Fayl seçilməyib" }, { status: 400 });
  const date = field(form, "date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Tarix düzgün deyil" }, { status: 400 });
  // Ad yalnız tək faylda tətbiq olunur; çox faylda hər biri öz adını alır
  const title = files.length === 1 ? field(form, "title") : null;
  const number = field(form, "number");

  const saved: string[] = [];
  const rejected: { name: string; reason: string }[] = [];
  for (const file of files) {
    const ext = extensionOf(file.name);
    if (!ext) {
      rejected.push({ name: file.name, reason: "Bu fayl növü qəbul olunmur" });
      continue;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      rejected.push({ name: file.name, reason: "Fayl 30 MB-dan böyükdür" });
      continue;
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (!matchesSignature(ext, buf)) {
      rejected.push({ name: file.name, reason: "Faylın məzmunu uzantısına uyğun gəlmir" });
      continue;
    }
    const id = randomUUID();
    const storagePath = await saveDocumentFile(personId, id, ext, buf);
    const docTitle = title ?? file.name.replace(/\.[^.]+$/, "").slice(0, 200);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.personDocument.create({
          data: {
            id,
            personId,
            kind,
            title: docTitle,
            number,
            documentDate: new Date(`${date}T00:00:00Z`),
            fileName: file.name.slice(0, 255),
            extension: ext,
            size: file.size,
            storagePath,
            uploadedById: user.id,
          },
        });
        await audit(
          { user, action: "CREATE", entity: "PersonDocument", entityId: id, summary: `Şəxsi işə sənəd əlavə edildi: ${person.fullName} (${person.code}) — ${docTitle} (${file.name})` },
          tx,
        );
      });
    } catch (e) {
      await removeDocumentFile(storagePath);
      throw e;
    }
    saved.push(id);
  }

  if (saved.length === 0) return NextResponse.json({ error: "Heç bir fayl qəbul olunmadı", rejected }, { status: 400 });
  return NextResponse.json({ saved: saved.length, rejected });
}
