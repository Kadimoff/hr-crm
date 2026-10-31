import Link from "next/link";
import { RequestsAdmin } from "@/components/admin/requests-admin";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sorğular" };

const HISTORY_LIMIT = 200;

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireUser("requests.manage");
  const history = (await searchParams).view === "history";
  const [rows, pendingCount] = await Promise.all([
    prisma.documentDeletionRequest.findMany({
      where: history ? { status: { not: "PENDING" } } : { status: "PENDING" },
      orderBy: history ? { decidedAt: "desc" } : { createdAt: "asc" },
      take: history ? HISTORY_LIMIT : undefined,
      include: {
        requestedBy: { select: { fullName: true, username: true } },
        decidedBy: { select: { fullName: true, username: true } },
        document: { select: { kind: true, extension: true, size: true, number: true, documentDate: true } },
      },
    }),
    prisma.documentDeletionRequest.count({ where: { status: "PENDING" } }),
  ]);

  const tab = (href: string, label: string, active: boolean, count?: number) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors", active ? "bg-card text-foreground shadow-sm" : "hover:text-foreground")}
    >
      {label}
      {count ? <span className="rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold text-warning tabular-nums">{count}</span> : null}
    </Link>
  );

  return (
    <>
      <PageHeader title="Sorğular" description="Şəxsi iş sənədlərinin silinməsi üçün göndərilən sorğular · təsdiqdə sənəd silinir · bütün qərarlar audit jurnalına yazılır" />
      <nav className="mb-4 inline-flex items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
        {tab("/admin/requests", "Gözləyən", !history, pendingCount)}
        {tab("/admin/requests?view=history", "Tarixçə", history)}
      </nav>
      <RequestsAdmin
        history={history}
        rows={rows.map((r) => ({
          id: r.id,
          status: r.status,
          personId: r.personId,
          personName: r.personName,
          documentId: r.documentId,
          documentTitle: r.documentTitle,
          fileName: r.fileName,
          kind: r.document?.kind ?? null,
          number: r.document?.number ?? null,
          reason: r.reason,
          requestedBy: r.requestedBy ? `${r.requestedBy.fullName} (@${r.requestedBy.username})` : "—",
          createdAt: r.createdAt.toISOString(),
          decidedBy: r.decidedBy ? `${r.decidedBy.fullName} (@${r.decidedBy.username})` : null,
          decidedAt: r.decidedAt?.toISOString() ?? null,
          decisionNote: r.decisionNote,
        }))}
      />
    </>
  );
}
