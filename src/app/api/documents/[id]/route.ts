import { apiUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { documentType } from "@/lib/document-types";
import { contentDisposition, findAccessibleDocument, readDocumentFile } from "@/lib/documents";

export const runtime = "nodejs";

/** Şəxsi iş sənədi: PDF və şəkil brauzerdə açılır (inline), ?download=1 və ya digər növlər — yüklənir */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser("employees.view");
  if (user instanceof Response) return user;
  const { id } = await params;
  const doc = await findAccessibleDocument(user, id);
  const buf = doc && (await readDocumentFile(doc.storagePath));
  if (!doc || !buf) return Response.json({ error: "Sənəd tapılmadı" }, { status: 404 });

  const type = documentType(doc.extension);
  const download = new URL(request.url).searchParams.has("download") || type?.view !== "file";
  if (download) {
    await audit({ user, action: "EXPORT", entity: "PersonDocument", entityId: doc.id, summary: `Şəxsi iş sənədi yükləndi: ${doc.person.fullName} — ${doc.title} (${doc.fileName})` });
  }
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": type?.mime ?? "application/octet-stream",
      "Content-Disposition": contentDisposition(download ? "attachment" : "inline", doc.fileName),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
