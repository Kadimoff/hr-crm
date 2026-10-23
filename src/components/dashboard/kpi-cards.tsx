"use client";

import { motion } from "framer-motion";
import { BanknoteIcon, GraduationCapIcon, PalmtreeIcon, PresentationIcon, TargetIcon, UserCheckIcon, UsersIcon, type LucideIcon } from "lucide-react";
import type * as React from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { Kpis } from "@/lib/dashboard/filters";
import { cn, formatAzn, formatNumber } from "@/lib/utils";
import { Chip } from "./charts";

const pct = (v: number | null) => (v === null ? "—" : `${formatNumber(v * 100, 1)}%`);

type Tone = "primary" | "success" | "warning" | "danger" | "muted";

/** Kartın altındakı köməkçi göstərici: "Ştat: 680" */
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="text-muted-foreground">
      {label}: <b className="font-semibold text-foreground">{value}</b>
    </span>
  );
}

export function KpiCards({ kpi, filtered = false }: { kpi: Kpis; filtered?: boolean }) {
  const fillTone: Tone = kpi.fillRate === null ? "muted" : kpi.fillRate > 1 ? "danger" : kpi.fillRate >= 0.85 ? "success" : "warning";
  const vacant = kpi.totalUnits - kpi.filledUnits;
  const items: { label: string; value: string; unit?: string; icon: LucideIcon; tone: Tone; progress?: number; left: React.ReactNode; right?: React.ReactNode }[] = [
    {
      label: "Ümumi say",
      value: formatNumber(kpi.headcount),
      unit: "nəfər",
      icon: UsersIcon,
      tone: "primary",
      left: (
        <span className="font-medium text-success">
          <UserCheckIcon className="mr-1 inline size-3" />
          {formatNumber(kpi.contracts)} müqavilə
        </span>
      ),
      right: <Stat label="Əvəzçi" value={formatNumber(kpi.multiContract)} />,
    },
    {
      label: "Ştat doluluğu",
      value: pct(kpi.fillRate),
      icon: TargetIcon,
      tone: fillTone,
      progress: kpi.fillRate === null ? undefined : Math.min(100, kpi.fillRate * 100),
      left: <Stat label="Ştat" value={formatNumber(kpi.totalUnits, 2)} />,
      right:
        kpi.totalUnits === 0 ? undefined : vacant >= 0 ? (
          <Chip tone="warning">{formatNumber(vacant, 2)} vakant</Chip>
        ) : (
          <Chip tone="danger">{formatNumber(-vacant, 2)} artıq</Chip>
        ),
    },
    {
      label: "Akademik heyət",
      value: formatNumber(kpi.academic),
      unit: `PMH · ${pct(kpi.academicRatio)}`,
      icon: PresentationIcon,
      tone: "primary",
      left: <Stat label="İnzibati" value={formatNumber(kpi.administrative)} />,
      right: <Stat label="Tədris-k." value={formatNumber(kpi.teachingSupport)} />,
    },
    {
      label: "Elmi potensial (PMH)",
      value: pct(kpi.degreeRatio),
      unit: "dərəcəli",
      icon: GraduationCapIcon,
      tone: "warning",
      left: <Stat label="Elmlər d." value={formatNumber(kpi.doctorsOfScience)} />,
      right: <Stat label="Fəlsəfə d." value={formatNumber(kpi.doctorsOfPhilosophy)} />,
    },
    {
      label: "Aylıq ƏH fondu (brutto)",
      value: formatAzn(kpi.payrollGross),
      icon: BanknoteIcon,
      tone: "success",
      left: <Stat label="Netto" value={formatAzn(kpi.payrollNet)} />,
      right: (
        <span title="İşəgötürən xərci">
          <Stat label="İX" value={formatAzn(kpi.payrollEmployerCost)} />
        </span>
      ),
    },
    {
      label: "Aktiv məzuniyyət",
      value: formatNumber(kpi.activeLeaves),
      unit: "nəfər",
      icon: PalmtreeIcon,
      tone: "danger",
      left: (
        <span className="text-muted-foreground">
          Heyətin <b className="font-semibold text-foreground">{pct(kpi.headcount ? kpi.activeLeaves / kpi.headcount : null)}</b>-i
        </span>
      ),
      right: <span className="text-muted-foreground">bu gün işdə deyil</span>,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {items.map((item, i) => (
        <motion.div key={item.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.3 }}>
          <Card
            className={cn(
              "group flex h-full flex-col p-4 transition-colors",
              item.tone === "primary" && "hover:border-primary/50",
              item.tone === "success" && "hover:border-success/50",
              item.tone === "warning" && "hover:border-warning/50",
              item.tone === "danger" && "hover:border-danger/50",
            )}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">{item.label}</span>
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
            <div className="text-2xl font-extrabold tracking-tight tabular-nums">
              {item.value} {item.unit && <span className="text-xs font-normal text-muted-foreground">{item.unit}</span>}
            </div>
            {item.progress !== undefined && (
              <Progress
                value={item.progress}
                className="mt-2"
                indicatorClassName={cn(fillTone === "success" && "bg-success", fillTone === "warning" && "bg-warning", fillTone === "danger" && "bg-danger")}
              />
            )}
            <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[11px] tabular-nums">
              {item.left}
              {item.right}
            </div>
            {filtered && <div className="mt-1 text-[10px] font-medium text-primary">filtrlənib</div>}
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
