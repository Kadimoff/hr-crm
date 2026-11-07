"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccessPerson } from "@/lib/auth/scope";
import { assertUser, AuthError } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

/** Müqavilə sonu üzrə məsul şəxs və sonrakı qərar (TZ M05-03 qəbul meyarı) */
export async function saveContractEndAction(employmentId: string, owner: string, decision: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    const user = await assertUser("employees.edit");
    const v = z.object({ owner: z.string().trim().max(200), decision: z.string().trim().max(1000) }).parse({ owner, decision });
    const e = await prisma.employment.findUnique({ where: { id: employmentId }, select: { personId: true, contractEndOwner: true, contractEndNote: true, person: { select: { fullName: true, code: true } } } });
    if (!e || !(await canAccessPerson(user, e.personId))) return { error: "Müqavilə tapılmadı" };
    await prisma.$transaction(async (tx) => {
      await tx.employment.update({ where: { id: employmentId }, data: { contractEndOwner: v.owner || null, contractEndNote: v.decision || null } });
      await audit(
        {
          user,
          action: "UPDATE",
          entity: "Person",
          entityId: e.personId,
          summary: `Müqavilə sonu üzrə qərar: ${e.person.fullName} (${e.person.code})`,
          changes: { "employment.contractEndOwner": [e.contractEndOwner, v.owner || null], "employment.contractEndNote": [e.contractEndNote, v.decision || null] },
        },
        tx,
      );
    });
    revalidatePath("/contracts");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof AuthError || err instanceof Error ? err.message : "Xəta" };
  }
}
