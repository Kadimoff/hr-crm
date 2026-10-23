"use client";

import { motion } from "framer-motion";
import { BanknoteIcon, GraduationCapIcon, PalmtreeIcon, TargetIcon, UsersIcon, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { Kpis } from "@/lib/dashboard/filters";
import { cn, formatAzn, formatNumber } from "@/lib/utils";

const pct = (v: number | null) => (v === null ? "—" : `${formatNumber(v * 100, 1)}%`);

export function KpiCards({ kpi, filtered = false }: { kpi: Kpis; filtered?: boolean }) {
  const fillTone = kpi.fillRate === null ? "muted" : kpi.fillRate > 1 ? "danger" : kpi.fillRate >= 0.85 ? "success" : "warning";
  const items: { label: string; value: string; hint: string; icon: LucideIcon; tone: string; progress?: number }[] = [
    { label: "Ümumi say", value: formatNumber(kpi.headcount), hint: "Aktiv əmək müqaviləsi olan şəxslər", icon: UsersIcon, tone: "primary" },
    {
      label: "Ştat doluluğu",
      value: pct(kpi.fillRate),
      hint: `${formatNumber(kpi.filledUnits, 2)} / ${formatNumber(kpi.totalUnits, 2)} ştat vahidi`,
      icon: TargetIcon,
      tone: fillTone,
      progress: kpi.fillRate === null ? undefined : Math.min(100, kpi.fillRate * 100),
    },
    { label: "Akademik heyət", value: pct(kpi.academicRatio), hint: "Professor-müəllim heyətinin payı", icon: GraduationCapIcon, tone: "primary" },
    {
      label: "Aylıq ƏH fondu (brutto)",
      value: formatAzn(kpi.payrollGross),
      hint: `Netto ${formatAzn(kpi.payrollNet)} · İşəgötürən xərci ${formatAzn(kpi.payrollEmployerCost)}`,
      icon: BanknoteIcon,
      tone: "success",
    },
    { label: "Aktiv məzuniyyət", value: formatNumber(kpi.activeLeaves), hint: "Bu gün işdə iştirak etməyənlər", icon: PalmtreeIcon, tone: "warning" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item, i) => (
        <motion.div key={item.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.3 }}>
          <Card className="group h-full p-5 transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between">
              <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg transition-transform group-hover:scale-110",
                  item.tone === "primary" && "bg-primary/10 text-primary",
                  item.tone === "success" && "bg-success-soft text-success",
                  item.tone === "warning" && "bg-warning-soft text-warning",
                  item.tone === "danger" && "bg-danger-soft text-danger",
                  item.tone === "muted" && "bg-muted text-muted-foreground",
                )}
              >
                <item.icon className="size-4" />
              </span>
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{item.value}</div>
            {item.progress !== undefined && (
              <Progress
                value={item.progress}
                className="mt-3"
                indicatorClassName={cn(item.tone === "success" && "bg-success", item.tone === "warning" && "bg-warning", item.tone === "danger" && "bg-danger")}
              />
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {item.hint}
              {filtered && <span className="text-primary"> · filtrlənib</span>}
            </p>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
