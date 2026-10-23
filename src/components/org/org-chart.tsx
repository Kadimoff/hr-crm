"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BuildingIcon, ChevronDownIcon, GraduationCapIcon, LandmarkIcon, MinusIcon, NetworkIcon, PlusIcon, RotateCcwIcon, SearchIcon, UsersIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { OrgNode } from "@/lib/queries";
import { cn } from "@/lib/utils";

const LEVEL_LABEL = ["", "1-ci səviyyə", "2-ci səviyyə", "3-cü səviyyə", "4-cü səviyyə"];

function collectIds(nodes: OrgNode[], depth: number, out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.level <= depth) out.add(n.id);
    collectIds(n.children, depth, out);
  }
  return out;
}

/** Axtarışa uyğun düyünləri və onların əcdadlarını saxlayır */
function filterTree(nodes: OrgNode[], q: string): OrgNode[] {
  if (!q) return nodes;
  const out: OrgNode[] = [];
  for (const n of nodes) {
    const kids = filterTree(n.children, q);
    if (kids.length || n.name.toLocaleLowerCase("az").includes(q) || n.code.toLocaleLowerCase("az").includes(q)) out.push({ ...n, children: kids });
  }
  return out;
}

export function OrgChart({ tree }: { tree: OrgNode[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => collectIds(tree, 1));
  const [zoom, setZoom] = useState(1);
  const [query, setQuery] = useState("");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const q = query.trim().toLocaleLowerCase("az");
  const visible = useMemo(() => filterTree(tree, q), [tree, q]);
  const openSet = q ? collectIds(visible, 4) : expanded;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const totals = useMemo(() => tree.reduce((acc, n) => ({ units: acc.units + n.units, filled: acc.filled + n.filled, headcount: acc.headcount + n.headcount }), { units: 0, filled: 0, headcount: 0 }), [tree]);

  if (tree.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
        <NetworkIcon className="size-8" />
        Struktur bölmələri hələ idxal edilməyib
        <Button asChild size="sm">
          <a href="/import">İdxal mərkəzi</a>
        </Button>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Bölmə axtar…" className="pl-9" />
        </div>
        <div className="flex gap-1">
          {[1, 2, 3, 4].map((lvl) => (
            <Button key={lvl} variant="outline" size="sm" onClick={() => setExpanded(collectIds(tree, lvl))}>
              {lvl}
            </Button>
          ))}
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground tabular-nums">
          <span>{totals.headcount} əməkdaş</span>
          <span>
            {totals.filled.toFixed(1)} / {totals.units.toFixed(1)} ştat
          </span>
          <span className="text-warning">{Math.max(0, totals.units - totals.filled).toFixed(1)} vakansiya</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-8" aria-label="Kiçilt" onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}>
            <MinusIcon />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button variant="outline" size="icon" className="size-8" aria-label="Böyüt" onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}>
            <PlusIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Sıfırla"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            <RotateCcwIcon />
          </Button>
        </div>
      </div>
      <div
        className="relative h-[calc(100dvh-250px)] min-h-[420px] cursor-grab overflow-hidden bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px] active:cursor-grabbing"
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          setZoom((z) => Math.min(1.6, Math.max(0.4, z - e.deltaY * 0.002)));
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <div className="absolute top-6 left-6 origin-top-left transition-transform duration-75" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <ul className="flex flex-col gap-2">
            {visible.map((n) => (
              <TreeNode key={n.id} node={n} open={openSet} onToggle={toggle} highlight={q} />
            ))}
          </ul>
        </div>
        <p className="pointer-events-none absolute right-3 bottom-2 text-[11px] text-muted-foreground">Sürükləyin — hərəkət · Ctrl + təkər — miqyas</p>
      </div>
    </Card>
  );
}

function TreeNode({ node, open, onToggle, highlight }: { node: OrgNode; open: Set<string>; onToggle: (id: string) => void; highlight: string }) {
  const isOpen = open.has(node.id);
  const vacancy = Math.max(0, node.units - node.filled);
  const over = node.filled > node.units + 1e-9 && node.units > 0;
  const fill = node.units > 0 ? Math.min(100, (node.filled / node.units) * 100) : 0;
  const Icon = node.isFaculty ? GraduationCapIcon : node.isChair ? LandmarkIcon : node.level === 1 ? BuildingIcon : UsersIcon;
  const match = highlight && node.name.toLocaleLowerCase("az").includes(highlight);

  return (
    <li className="relative">
      <div
        className={cn(
          "flex w-[360px] items-center gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-xs transition-shadow hover:shadow-md",
          node.closed && "opacity-50",
          match && "ring-2 ring-primary",
        )}
      >
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          disabled={node.children.length === 0}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-0"
          aria-label={isOpen ? "Bağla" : "Aç"}
        >
          <ChevronDownIcon className={cn("size-4 transition-transform", !isOpen && "-rotate-90")} />
        </button>
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md",
            node.isFaculty ? "bg-primary/10 text-primary" : node.isChair ? "bg-chart-4/15 text-chart-4" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{node.name}</span>
            {node.closed && <Badge variant="danger">ləğv</Badge>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-mono">{node.code}</span>
            <span>{LEVEL_LABEL[node.level]}</span>
            <span className="tabular-nums">{node.headcount} nəfər</span>
          </div>
          {node.units > 0 && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", over ? "bg-danger" : fill >= 85 ? "bg-success" : "bg-warning")} style={{ width: `${fill}%` }} />
              </div>
              <span className={cn("text-[11px] tabular-nums", over ? "text-danger" : vacancy > 0 ? "text-warning" : "text-success")}>
                {over ? `+${(node.filled - node.units).toFixed(2)} artıq` : vacancy > 0 ? `${vacancy.toFixed(2)} vakansiya` : "dolu"}
              </span>
            </div>
          )}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {isOpen && node.children.length > 0 && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="ml-6 flex flex-col gap-2 overflow-hidden border-l border-dashed pt-2 pl-6"
          >
            {node.children.map((c) => (
              <TreeNode key={c.id} node={c} open={open} onToggle={onToggle} highlight={highlight} />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}
