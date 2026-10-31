"use server";

import { revalidatePath } from "next/cache";
import { canDeleteDocumentsDirectly } from "@/lib/auth/roles";
import { assertUser, type CurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { DELETE_CONFIRM_WORD, matchesConfirmWord } from "@/lib/confirm";
import { prisma } from "@/lib/db";
import { findAccessibleDocument, removeDocumentFile } from "@/lib/documents";

export interface DocActionResult {
  error?: string;
}

const REASON_MIN = 5;
const REASON_MAX = 300;

function reasonProblem(reason: string): string | null {
  const r = reason.trim();
  if (r.length < REASON_MIN) return `Silmə səbəbini qısa yazın (ən azı ${REASON_MIN} simvol)`;
  if (r.length > REASON_MAX) return `Səbəb ${REASON_MAX} simvoldan uzun olmamalıdır`;
  return null;
}

const refresh = (personId: string) => {
  revalidatePath(`/employees/${personId}`);
  revalidatePath("/admin/requests", "layout");
};

/**
 * Sənədi və faylını silir; həmin sənədə gözləyən sorğular bağlanır.
 * how — audit-də necə silindiyi (birbaşa və ya sorğu əsasında).
 */
async function removeDocument(actor: CurrentUser, documentId: string, reason: string, how: string, closingRequestId?: string) {
  const doc = await prisma.personDocument.findUnique({ where: { id: documentId }, include: { person: { select: { fullName: true, code: true } } } });
  if (!doc) return null;
  await prisma.$transaction(async (tx) => {
    await tx.documentDeletionRequest.updateMany({
      where: { documentId, status: "PENDING", ...(closingRequestId ? { id: { not: closingRequestId } } : {}) },
      data: { status: "APPROVED", decidedById: actor.id, decidedAt: new Date(), decisionNote: "Sənəd silindi" },
    });
    await tx.personDocument.delete({ where: { id: documentId } });
    const { person, storagePath: _path, ...snapshot } = doc;
    await audit(
      {
        user: actor,
        action: "DELETE",
        entity: "PersonDocument",
        entityId: documentId,
        summary: `Şəxsi iş sənədi silindi (${how}): ${person.fullName} (${person.code}) — ${doc.title} (${doc.fileName}) · səbəb: ${reason}`,
        changes: { ...snapshot, reason },
      },
      tx,
    );
  });
  await removeDocumentFile(doc.storagePath);
  return doc;
}

/** Birbaşa silmə — root və icazəli istifadəçilər; səbəb + "sil" təsdiqi */
export async function deleteDocumentAction(id: string, reason: string, confirmation: string): Promise<DocActionResult> {
  const user = await assertUser("employees.view");
  if (!canDeleteDocumentsDirectly(user)) return { error: "Sənədi birbaşa silmək hüququnuz yoxdur — silmə sorğusu göndərin" };
  const problem = reasonProblem(reason);
  if (problem) return { error: problem };
  if (!matchesConfirmWord(confirmation)) return { error: `Təsdiq üçün "${DELETE_CONFIRM_WORD}" yazın` };
  const doc = await findAccessibleDocument(user, id);
  if (!doc) return { error: "Sənəd tapılmadı" };
  await removeDocument(user, id, reason.trim(), "birbaşa");
  refresh(doc.personId);
  return {};
}

/** Silmə sorğusu — sənədi görə bilən hər kəs; root Sorğular panelində qərar verir */
export async function requestDocumentDeletionAction(id: string, reason: string): Promise<DocActionResult> {
  const user = await assertUser("employees.view");
  const problem = reasonProblem(reason);
  if (problem) return { error: problem };
  const doc = await findAccessibleDocument(user, id);
  if (!doc) return { error: "Sənəd tapılmadı" };
  if (await prisma.documentDeletionRequest.count({ where: { documentId: id, status: "PENDING" } })) return { error: "Bu sənəd üçün silmə sorğusu artıq göndərilib" };

  await prisma.$transaction(async (tx) => {
    const req = await tx.documentDeletionRequest.create({
      data: { documentId: id, personId: doc.personId, personName: doc.person.fullName, documentTitle: doc.title, fileName: doc.fileName, reason: reason.trim(), requestedById: user.id },
    });
    await audit(
      { user, action: "CREATE", entity: "DocumentDeletionRequest", entityId: req.id, summary: `Silmə sorğusu göndərildi: ${doc.person.fullName} — ${doc.title} (${doc.fileName}) · səbəb: ${reason.trim()}` },
      tx,
    );
  });
  refresh(doc.personId);
  return {};
}

/** Root: sorğunu təsdiq edir — sənəd silinir */
export async function approveDeletionRequestAction(id: string): Promise<DocActionResult> {
  const user = await assertUser("requests.manage");
  const req = await prisma.documentDeletionRequest.findUnique({ where: { id }, include: { requestedBy: { select: { username: true } } } });
  if (!req || req.status !== "PENDING") return { error: "Sorğu tapılmadı və ya artıq baxılıb" };
  const how = `@${req.requestedBy?.username ?? "?"} sorğusu əsasında`;
  const removed = req.documentId ? await removeDocument(user, req.documentId, req.reason, how, id) : null;
  await prisma.$transaction(async (tx) => {
    await tx.documentDeletionRequest.update({
      where: { id },
      data: { status: "APPROVED", decidedById: user.id, decidedAt: new Date(), decisionNote: removed ? null : "Sənəd artıq silinmişdi" },
    });
    await audit({ user, action: "UPDATE", entity: "DocumentDeletionRequest", entityId: id, summary: `Silmə sorğusu təsdiq edildi: ${req.personName} — ${req.documentTitle}` }, tx);
  });
  refresh(req.personId);
  return {};
}

/** Root: sorğudan imtina — sənəd qalır */
export async function rejectDeletionRequestAction(id: string, note: string): Promise<DocActionResult> {
  const user = await assertUser("requests.manage");
  const req = await prisma.documentDeletionRequest.findUnique({ where: { id } });
  if (!req || req.status !== "PENDING") return { error: "Sorğu tapılmadı və ya artıq baxılıb" };
  const decisionNote = note.trim().slice(0, REASON_MAX) || null;
  await prisma.$transaction(async (tx) => {
    await tx.documentDeletionRequest.update({ where: { id }, data: { status: "REJECTED", decidedById: user.id, decidedAt: new Date(), decisionNote } });
    await audit(
      { user, action: "UPDATE", entity: "DocumentDeletionRequest", entityId: id, summary: `Silmə sorğusundan imtina edildi: ${req.personName} — ${req.documentTitle}${decisionNote ? ` · qeyd: ${decisionNote}` : ""}` },
      tx,
    );
  });
  refresh(req.personId);
  return {};
}
