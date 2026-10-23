import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth/session";
import { getBatchSnapshot } from "@/lib/import-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const user = await apiUser("import");
  if (user instanceof Response) return user;
  const { batchId } = await params;
  const snapshot = await getBatchSnapshot(batchId);
  if (!snapshot) return NextResponse.json({ error: "Tapılmadı" }, { status: 404 });
  return NextResponse.json(snapshot);
}
