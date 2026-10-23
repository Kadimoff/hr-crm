"use client";

import { ChevronRightIcon, FilterXIcon } from "lucide-react";
import { Fragment, useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACADEMIC_CATEGORY, applyFilters, bucketize, CATEGORIES, GENDERS, type Bucket, type DashboardRow, type DepartmentOption } from "@/lib/dashboard/filters";
import { cn, formatNumber } from "@/lib/utils";
import { useDashboardFilters } from "./filter-context";

const DIM = 0.25;
const axis = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;
const pct = (v: number) => `${formatNumber(v * 100, 1)}%`;
const GENDER_COLOR: Record<string, string> = { Kişi: "var(--chart-1)", Qadın: "var(--chart-4)" };

/** Seçim varsa — seçilən tam, qalanları solğun */
const opacityFor = (selected: string | undefined, key: string) => (!selected || selected === key ? 1 : DIM);

export function ChartCard({ title, description, className, contentClassName, children, header, badge }: { title: string; description?: string; className?: string; contentClassName?: string; children: React.ReactNode; header?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription className="mt-0.5">{description}</CardDescription>}
          </div>
          {badge}
        </div>
        {header}
      </CardHeader>
      <CardContent className={cn("min-w-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/** Kart başlığının sağındakı xülasə çipi */
export function Chip({ tone = "muted", children, title }: { tone?: "muted" | "primary" | "success" | "warning" | "danger"; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold whitespace-nowrap tabular-nums",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "primary" && "bg-primary/10 text-primary",
        tone === "success" && "bg-success-soft text-success",
        tone === "warning" && "bg-warning-soft text-warning",
        tone === "danger" && "bg-danger-soft text-danger",
      )}
    >
      {children}
    </span>
  );
}

export function ChartEmpty({ filtered = true }: { filtered?: boolean }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
      <FilterXIcon className="size-6 opacity-60" />
      {filtered ? "Seçilmiş filtrlərə uyğun məlumat yoxdur" : "Məlumat yoxdur — İdxal mərkəzindən faylları yükləyin"}
    </div>
  );
}

/** Ortaq tooltip: say + pay (+ brutto ƏH fondundakı pay) */
function BucketTooltip({ active, payload, withPayroll = true }: { active?: boolean; payload?: { payload: Bucket }[]; withPayroll?: boolean }) {
  const b = payload?.[0]?.payload;
  if (!active || !b) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div className="mb-1 font-medium">{b.label}</div>
      <div className="flex justify-between gap-4 tabular-nums">
        <span className="text-muted-foreground">Əməkdaş</span>
        <span>
          {b.count} <span className="text-muted-foreground">· {pct(b.share)}</span>
        </span>
      </div>
      {withPayroll && (
        <div className="flex justify-between gap-4 tabular-nums">
          <span className="text-muted-foreground">ƏH fondunda payı</span>
          <span>{pct(b.grossShare)}</span>
        </div>
      )}
      <div className="mt-1.5 border-t pt-1.5 text-[11px] text-muted-foreground">Klik — filtr kimi seç / götür</div>
    </div>
  );
}

// ----------------------------------------------------------------------------
//  İşə qəbul dinamikası → year
// ----------------------------------------------------------------------------

export function HiresChart({ rows, className }: { rows: DashboardRow[]; className?: string }) {
  const { filters, toggle } = useDashboardFilters();
  const chart = useMemo(() => {
    const thisYear = new Date().getFullYear();
    // Seçilmiş il 10 illik pəncərədən əvvəldirsə, diapazon genişlənir
    const start = Math.min(thisYear - 9, filters.year ? Number(filters.year) || thisYear : thisYear);
    const years = Array.from({ length: thisYear - start + 1 }, (_, i) => String(start + i));
    const base = applyFilters(rows, filters, "year");
    return { empty: base.length === 0, start, thisYear, buckets: bucketize(base, (r) => (r.hireYear >= start ? String(r.hireYear) : null), years) };
  }, [rows, filters]);
  // Boş vəziyyət yalnız filtrə uyğun heç kim olmadıqda; pəncərədə qəbul yoxdursa xətt 0-da çəkilir
  const { empty, buckets: data } = chart;
  const hired = data.reduce((s, b) => s + b.count, 0);

  return (
    <ChartCard
      title="İşə qəbul dinamikası"
      description="Hazırda işləyən əməkdaşların işə qəbul ili · ilə klik edin"
      className={className}
      contentClassName="h-64"
      badge={
        <Chip tone="primary">
          {chart.start}–{chart.thisYear}: {formatNumber(hired)} qəbul
        </Chip>
      }
    >
      {empty ? (
        <ChartEmpty />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          {/* Xətt qrafiki: type="linear" — illər arasında saxta (kəsr) dəyərlər çəkilmir. Klik — ən yaxın il */}
          <AreaChart
            data={data}
            margin={{ left: -20, right: 12, top: 18 }}
            onClick={(state) => state?.activeLabel && toggle("year", String(state.activeLabel))}
            style={{ cursor: "pointer" }}
          >
            <defs>
              <linearGradient id="hires" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} {...axis} />
            <Tooltip content={<BucketTooltip />} cursor={{ stroke: "var(--border)" }} />
            {filters.year && <ReferenceLine x={filters.year} stroke="var(--chart-1)" strokeDasharray="4 4" strokeOpacity={0.6} />}
            <Area
              type="linear"
              dataKey="count"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#hires)"
              isAnimationActive={false}
              // Seçilmiş il böyük və tam, digər nöqtələr solğun
              dot={({ cx, cy, payload }: { cx: number; cy: number; payload: Bucket }) => {
                const selected = filters.year === payload.key;
                return (
                  <circle
                    key={payload.key}
                    cx={cx}
                    cy={cy}
                    r={selected ? 5.5 : 3.5}
                    fill={selected ? "var(--chart-1)" : "var(--card)"}
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    opacity={opacityFor(filters.year, payload.key)}
                  />
                );
              }}
              activeDot={{ r: 5, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
            >
              <LabelList dataKey="count" position="top" offset={10} fontSize={11} fill="var(--muted-foreground)" formatter={(v: number) => (v > 0 ? v : "")} />
            </Area>
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

// ----------------------------------------------------------------------------
//  Cins üzrə bölgü → gender
// ----------------------------------------------------------------------------

export function GenderChart({ rows, className }: { rows: DashboardRow[]; className?: string }) {
  const { filters, toggle } = useDashboardFilters();
  const data = useMemo(() => bucketize(applyFilters(rows, filters, "gender"), (r) => r.gender, GENDERS), [rows, filters]);
  const total = new Set(applyFilters(rows, filters, "gender").map((r) => r.personId)).size;
  const share = (g: string) => `${formatNumber((data.find((d) => d.key === g)?.share ?? 0) * 100)}%`;

  return (
    <ChartCard
      title="Cins üzrə bölgü"
      description="Əməkdaşlar · dilimə və ya leqendə klik edin"
      className={className}
      contentClassName="h-64"
      badge={
        total > 0 && (
          <Chip>
            Qadın {share("Qadın")} | Kişi {share("Kişi")}
          </Chip>
        )
      }
    >
      {total === 0 ? (
        <ChartEmpty />
      ) : (
        <div className="flex h-full flex-col">
          <div className="relative min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="count"
                  nameKey="label"
                  innerRadius="62%"
                  outerRadius="88%"
                  paddingAngle={data.filter((d) => d.count > 0).length > 1 ? 3 : 0}
                  strokeWidth={0}
                  cursor="pointer"
                  onClick={(_, i) => toggle("gender", data[i]!.key)}
                  isAnimationActive={false}
                >
                  {data.map((d) => (
                    <Cell key={d.key} fill={GENDER_COLOR[d.key]} fillOpacity={opacityFor(filters.gender, d.key)} />
                  ))}
                </Pie>
                <Tooltip content={<BucketTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            {/* Mərkəzdə ümumi say */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-semibold tabular-nums">{filters.gender ? (data.find((d) => d.key === filters.gender)?.count ?? 0) : total}</span>
              <span className="text-[11px] text-muted-foreground">{filters.gender ?? "cəmi"}</span>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-2 text-xs">
            {data.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => toggle("gender", d.key)}
                aria-pressed={filters.gender === d.key}
                className="flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-opacity hover:bg-muted"
                style={{ opacity: opacityFor(filters.gender, d.key) === 1 ? 1 : 0.5 }}
              >
                <span className="size-2 rounded-full" style={{ background: GENDER_COLOR[d.key] }} />
                {d.label}
                <span className="text-muted-foreground tabular-nums">
                  {d.count} · {pct(d.share)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </ChartCard>
  );
}

// ----------------------------------------------------------------------------
//  Heyət kateqoriyaları → category
// ----------------------------------------------------------------------------

export function CategoryChart({ rows, className }: { rows: DashboardRow[]; className?: string }) {
  const { filters, toggle } = useDashboardFilters();
  const base = useMemo(() => applyFilters(rows, filters, "category"), [rows, filters]);
  const data = useMemo(() => bucketize(base, (r) => r.category, CATEGORIES), [base]);
  const empty = data.every((d) => d.count === 0);
  const academic = data.find((d) => d.key === ACADEMIC_CATEGORY);

  return (
    <ChartCard
      title="Heyət kateqoriyaları"
      description="Vəzifənin heyət kateqoriyası · sətrə klik edin"
      className={className}
      contentClassName="h-72"
      badge={<Chip>{formatNumber(new Set(base.map((r) => r.personId)).size)} nəfər</Chip>}
    >
      {empty ? (
        <ChartEmpty />
      ) : (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 0, right: 36 }}>
                <CartesianGrid stroke="var(--border)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...axis} />
                <YAxis type="category" dataKey="label" width={118} {...axis} />
                <Tooltip content={<BucketTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.6 }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20} cursor="pointer" onClick={(_, i) => toggle("category", data[i]!.key)} isAnimationActive={false}>
                  {data.map((d, i) => (
                    <Cell key={d.key} fill={`var(--chart-${(i % 5) + 1})`} fillOpacity={opacityFor(filters.category, d.key)} />
                  ))}
                  {/* 0 dəyərlər də etiketlənir */}
                  <LabelList dataKey="count" position="right" fontSize={11} fill="var(--foreground)" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {academic && (
            <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs">
              <div className="flex items-center justify-between rounded-lg bg-muted/60 px-2 py-1">
                <span className="text-muted-foreground">PMH payı</span>
                <span className="font-bold text-primary tabular-nums">{pct(academic.share)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/60 px-2 py-1">
                <span className="text-muted-foreground">ƏH fondunda</span>
                <span className="font-bold text-success tabular-nums">{pct(academic.grossShare)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </ChartCard>
  );
}

// ----------------------------------------------------------------------------
//  Struktur üzrə bölgü (drill-down) → department
// ----------------------------------------------------------------------------

export function StructureChart({ rows, departments, className }: { rows: DashboardRow[]; departments: DepartmentOption[]; className?: string }) {
  const { filters, set } = useDashboardFilters();
  const byId = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, DepartmentOption[]>();
    for (const d of departments) {
      // Səlahiyyət xaricindəki valideyn — bu istifadəçi üçün kök sayılır
      const parent = d.parentId && byId.has(d.parentId) ? d.parentId : null;
      m.set(parent, [...(m.get(parent) ?? []), d]);
    }
    return m;
  }, [departments, byId]);

  // Drill səviyyəsi seçimdən çıxarılır: alt bölmələri olan seçim → onun övladları; yarpaq → qardaşları
  const selected = filters.department ? byId.get(filters.department) : undefined;
  const parent = selected ? (childrenOf.has(selected.id) ? selected : selected.parentId && byId.has(selected.parentId) ? byId.get(selected.parentId)! : null) : null;
  const highlight = selected && selected.id !== parent?.id ? selected.id : undefined;

  const trail = useMemo(() => {
    const out: DepartmentOption[] = [];
    for (let d: DepartmentOption | undefined = parent ?? undefined; d; d = d.parentId ? byId.get(d.parentId) : undefined) out.unshift(d);
    return out;
  }, [parent, byId]);

  const data = useMemo(() => {
    const base = applyFilters(rows, filters, "department").filter((r) => !parent || r.deptPath.some((p) => p.id === parent.id));
    const kids = childrenOf.get(parent?.id ?? null) ?? [];
    const kidIds = new Set(kids.map((k) => k.id));
    const keyOf = (r: DashboardRow) => {
      const hit = r.deptPath.find((p) => kidIds.has(p.id));
      if (hit) return hit.id;
      return parent && r.deptPath[r.deptPath.length - 1]?.id === parent.id ? parent.id : null;
    };
    const buckets = bucketize(base, keyOf, kids.map((k) => k.id), (k) => (k === parent?.id ? `${parent.name} (birbaşa)` : (byId.get(k)?.name ?? k)));
    return buckets.sort((a, b) => b.count - a.count);
  }, [rows, filters, parent, childrenOf, byId]);

  const empty = data.every((d) => d.count === 0);
  const onBar = (key: string) => {
    if (key === parent?.id) return;
    // Yarpaq seçimini götürmək — bir səviyyə yuxarı qayıdır
    set("department", filters.department === key ? parent?.id : key);
  };

  return (
    <ChartCard
      title="Struktur üzrə bölgü"
      description="Bölməyə klik — alt bölmələrə enmək və filtr"
      className={className}
      contentClassName="min-h-64"
      badge={<Chip>{data.length} bölmə</Chip>}
      header={
        <nav aria-label="Struktur səviyyəsi" className="mt-2 flex flex-wrap items-center gap-1 text-xs">
          <button type="button" onClick={() => set("department", undefined)} className={cn("rounded px-1.5 py-0.5 hover:bg-muted", trail.length === 0 ? "font-medium text-foreground" : "text-primary")}>
            Bütün strukturlar
          </button>
          {trail.map((d, i) => (
            <Fragment key={d.id}>
              <ChevronRightIcon className="size-3 text-muted-foreground" />
              <button
                type="button"
                onClick={() => set("department", d.id)}
                className={cn("rounded px-1.5 py-0.5 hover:bg-muted", i === trail.length - 1 ? "font-medium text-foreground" : "text-primary")}
              >
                {d.name}
              </button>
            </Fragment>
          ))}
        </nav>
      }
    >
      {empty ? (
        <ChartEmpty />
      ) : (
        <div style={{ height: Math.max(180, data.length * 38 + 30) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 36 }}>
              <CartesianGrid stroke="var(--border)" horizontal={false} />
              <XAxis type="number" allowDecimals={false} {...axis} />
              <YAxis type="category" dataKey="label" width={170} {...axis} tickFormatter={(v: string) => (v.length > 26 ? `${v.slice(0, 25)}…` : v)} />
              <Tooltip content={<BucketTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.6 }} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20} cursor="pointer" onClick={(_, i) => onBar(data[i]!.key)} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.key} fill="var(--chart-5)" fillOpacity={opacityFor(highlight, d.key)} />
                ))}
                <LabelList dataKey="count" position="right" fontSize={11} fill="var(--foreground)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

