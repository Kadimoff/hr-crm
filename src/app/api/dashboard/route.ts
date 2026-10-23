import { departmentScope } from "@/lib/auth/scope";
import { apiUser } from "@/lib/auth/session";
import { getDashboardDataset } from "@/lib/dashboard/data";
import { applyFilters, applyStaffingFilters, computeKpis, parseFilters } from "@/lib/dashboard/filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server tərəfli filtrləmə üçün hazır API (verilənlər böyüdükdə client-side filtrləmənin əvəzi):
 * GET /api/dashboard?department=<id>&category=…&year=…&gender=…&degree=…
 * Cavab: filtrlənmiş sətirlər + KPI. Hazırda səhifə bütün verilənləri bir dəfə alıb client-də süzür.
 */
export async function GET(request: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const filters = parseFilters(new URL(request.url).searchParams);
  const data = await getDashboardDataset(await departmentScope(user));
  const rows = applyFilters(data.rows, filters);
  return Response.json({ filters, kpi: computeKpis(rows, applyStaffingFilters(data.staffing, filters)), rows });
}
