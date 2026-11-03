"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser, AuthError } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { isSalaryPrivileged } from "@/lib/salary-privacy";

/** Şəxs səviyyəsində maaş məxfiliyi — yalnız root və «məxfi maaşları görə bilər» hesabı */
export async function setPersonSalaryRestrictedAction(personId: string, restricted: boolean): Promise<{ ok?: boolean; error?: string }> {
  try {
    const user = await assertUser("employees.edit");
    if (!isSalaryPrivileged(user)) throw new AuthError("Maaş məxfiliyini yalnız root və ya səlahiyyətli hesab dəyişə bilər", 403);
    z.string().min(1).parse(personId);
    z.boolean().parse(restricted);
    const before = await prisma.person.findUnique({ where: { id: personId }, select: { fullName: true, code: true, salaryRestricted: true } });
    if (!before) return { error: "Əməkdaş tapılmadı" };
    if (before.salaryRestricted === restricted) return { ok: true };
    await prisma.$transaction(async (tx) => {
      await tx.person.update({ where: { id: personId }, data: { salaryRestricted: restricted } });
      await audit(
        {
          user,
          action: "UPDATE",
          entity: "Person",
          entityId: personId,
          summary: `Maaş məxfiliyi ${restricted ? "qoşuldu" : "götürüldü"}: ${before.fullName} (${before.code})`,
          changes: { salaryRestricted: [before.salaryRestricted, restricted] },
        },
        tx,
      );
    });
    revalidatePath(`/employees/${personId}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Alınmadı" };
  }
}
