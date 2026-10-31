import { apiUser } from "@/lib/auth/session";
import { documentPreviewHtml, findAccessibleDocument, readDocumentFile } from "@/lib/documents";

export const runtime = "nodejs";

/** Word/Excel sənədinin HTML görünüşü — skriptsiz sandbox-da (CSP), dosyedə iframe-də göstərilir */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser("employees.view");
  if (user instanceof Response) return user;
  const { id } = await params;
  const doc = await findAccessibleDocument(user, id);
  const buf = doc && (await readDocumentFile(doc.storagePath));
  if (!doc || !buf) return Response.json({ error: "Sənəd tapılmadı" }, { status: 404 });

  const html = await documentPreviewHtml(doc.extension, buf, doc.title).catch(() => null);
  if (!html) return Response.json({ error: "Bu sənədin önizləməsi alınmadı — faylı yükləyib açın" }, { status: 415 });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
