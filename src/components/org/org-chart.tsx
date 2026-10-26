"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeftIcon,
  Building2Icon,
  BuildingIcon,
  CrosshairIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
  LandmarkIcon,
  LayoutGridIcon,
  LoaderIcon,
  MailIcon,
  MaximizeIcon,
  MinusIcon,
  NetworkIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  Undo2Icon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { quickUpdatePersonAction, type QuickEditState } from "@/actions/persons";
import { deleteDepartmentAction, saveDepartmentAction, type DeptFormState } from "@/actions/structure";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OrgNode, OrgStaff, PersonFormOptions } from "@/lib/queries";
import { cn, formatAzn, formatIsoDate, formatNumber, initials } from "@/lib/utils";

// ----------------------------------------------------------------------------
//  Düzülüş: kök mərkəzdə, budaqlar iki tərəfə (mind map)
// ----------------------------------------------------------------------------

const HGAP = 72;
const VGAP = 14;
const SIZE = { root: { w: 260, h: 104 }, dept: { w: 284, h: 100 }, staff: { w: 210, h: 52 } };
const CHIP = { w: 214, h: 48, gap: 6, pad: 10 };
const BRANCH = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
/** Əl ilə dəyişdirilmiş mövqelər — brauzerdə saxlanılır */
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2;
const OFFSETS_KEY = "org-chart-offsets-v1";

type Kind = "root" | "dept" | "staff" | "grid";
type Offset = { x: number; y: number };

interface MapNode {
  key: string;
  kind: Kind;
  dept?: OrgNode;
  staff?: OrgStaff[];
  children: MapNode[];
  w: number;
  h: number;
}

interface Placed extends MapNode {
  x: number;
  y: number;
  dir: 1 | -1;
  color: string;
  parent?: Placed;
}

const gridCols = (n: number) => (n <= 6 ? 1 : n <= 18 ? 2 : 3);
function gridSize(n: number) {
  const cols = gridCols(n);
  const rows = Math.ceil(n / cols);
  return { w: cols * CHIP.w + (cols - 1) * CHIP.gap + CHIP.pad * 2, h: rows * CHIP.h + (rows - 1) * CHIP.gap + CHIP.pad * 2 };
}

/**
 * Avtomatik düzülüş + əl ilə sürüşdürmələr.
 * Kökün övladlarının tərəfi sıraya görə sabitdir (cüt — sağ, tək — sol): açıb-bağlayanda budaqlar tərəf dəyişmir.
 * Sürüşdürmə düyünə və onun bütün alt ağacına tətbiq olunur.
 */
function layout(root: MapNode, offsets: Record<string, Offset>) {
  const sub = new Map<MapNode, number>();
  const measure = (n: MapNode): number => {
    const kids = n.children.reduce((s, c) => s + measure(c), 0) + VGAP * Math.max(0, n.children.length - 1);
    const v = Math.max(n.h, kids);
    sub.set(n, v);
    return v;
  };
  measure(root);

  const placed: Placed[] = [];
  const place = (n: MapNode, edge: number, top: number, dir: 1 | -1, color: string, parent: Placed) => {
    const s = sub.get(n)!;
    const p: Placed = { ...n, x: dir === 1 ? edge : edge - n.w, y: top + (s - n.h) / 2, dir, color, parent };
    placed.push(p);
    const total = n.children.reduce((a, c) => a + sub.get(c)!, 0) + VGAP * Math.max(0, n.children.length - 1);
    let t = top + (s - total) / 2;
    for (const c of n.children) {
      place(c, dir === 1 ? p.x + p.w + HGAP : p.x - HGAP, t, dir, color, p);
      t += sub.get(c)! + VGAP;
    }
  };

  const rootPlaced: Placed = { ...root, x: -root.w / 2, y: -root.h / 2, dir: 1, color: BRANCH[0]! };
  placed.push(rootPlaced);
  for (const dir of [1, -1] as const) {
    const kids = root.children.filter((_, i) => (i % 2 === 0) === (dir === 1));
    const total = kids.reduce((a, c) => a + sub.get(c)!, 0) + VGAP * Math.max(0, kids.length - 1);
    let t = -total / 2;
    for (const c of kids) {
      const color = BRANCH[root.children.indexOf(c) % BRANCH.length]!;
      place(c, dir === 1 ? rootPlaced.x + rootPlaced.w + HGAP : rootPlaced.x - HGAP, t, dir, color, rootPlaced);
      t += sub.get(c)! + VGAP;
    }
  }

  // Valideynlər övladlardan əvvəl gəlir — sürüşdürmə yuxarıdan aşağı toplanır
  const acc = new Map<string, Offset>();
  for (const p of placed) {
    const base = p.parent ? acc.get(p.parent.key)! : { x: 0, y: 0 };
    const own = p.kind === "root" ? undefined : offsets[p.key];
    const total = { x: base.x + (own?.x ?? 0), y: base.y + (own?.y ?? 0) };
    acc.set(p.key, total);
    p.x += total.x;
    p.y += total.y;
  }
  separate(rootPlaced, placed);
  return placed;
}

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * Qonşu budaqların üst-üstə düşməməsi: aşağıdan yuxarı hər düyünün övladları (bütün alt ağacları ilə)
 * yuxarıdan aşağı sıralanır və kəsişən alt ağac aşağı sürüşdürülür. Avtomatik düzülüşdə heç nə dəyişmir,
 * əl ilə sürükləmədən və ya böyük heyət şəbəkəsi açılandan sonra isə aralarında VGAP qalır.
 */
function separate(root: Placed, placed: Placed[]) {
  const kids = new Map<Placed, Placed[]>();
  for (const p of placed) if (p.parent) kids.set(p.parent, [...(kids.get(p.parent) ?? []), p]);
  const box = (p: Placed): Box => {
    const b = { x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h };
    for (const c of kids.get(p) ?? []) {
      const k = box(c);
      b.x0 = Math.min(b.x0, k.x0);
      b.y0 = Math.min(b.y0, k.y0);
      b.x1 = Math.max(b.x1, k.x1);
      b.y1 = Math.max(b.y1, k.y1);
    }
    return b;
  };
  const shift = (p: Placed, dy: number) => {
    p.y += dy;
    for (const c of kids.get(p) ?? []) shift(c, dy);
  };
  const resolve = (p: Placed) => {
    const cs = kids.get(p) ?? [];
    cs.forEach(resolve);
    const items = cs.map((c) => ({ c, b: box(c) })).sort((a, b) => a.b.y0 - b.b.y0);
    items.forEach((it, i) => {
      for (let moved = true; moved; ) {
        moved = false;
        for (const prev of items.slice(0, i)) {
          const a = it.b;
          const b = prev.b;
          if (a.x0 < b.x1 + HGAP / 2 && b.x0 < a.x1 + HGAP / 2 && a.y0 < b.y1 + VGAP - 0.5 && b.y0 < a.y1 + VGAP - 0.5) {
            const dy = b.y1 + VGAP - a.y0;
            shift(it.c, dy);
            it.b = { ...a, y0: a.y0 + dy, y1: a.y1 + dy };
            moved = true;
          }
        }
      }
    });
  };
  resolve(root);
}

function edgePath(p: Placed) {
  const parent = p.parent!;
  // Sürüşdürmədən sonra uşaq valideynin o biri tərəfinə keçibsə, xətt ən yaxın kənardan çəkilir
  const right = p.x + p.w / 2 >= parent.x + parent.w / 2;
  const px = right ? parent.x + parent.w : parent.x;
  const py = parent.y + parent.h / 2;
  const cx = right ? p.x : p.x + p.w;
  const cy = p.y + p.h / 2;
  const mx = (px + cx) / 2;
  return `M ${px} ${py} C ${mx} ${py}, ${mx} ${cy}, ${cx} ${cy}`;
}

// ----------------------------------------------------------------------------
//  Köməkçilər
// ----------------------------------------------------------------------------

const LEVEL_LABEL = ["", "1-ci səviyyə", "2-ci səviyyə", "3-cü səviyyə", "4-cü səviyyə"];
const MAX_LEVEL = 4;
const norm = (s: string) => s.toLocaleLowerCase("az");

function indexTree(tree: OrgNode[]) {
  const byId = new Map<string, OrgNode>();
  const parentOf = new Map<string, string | null>();
  const walk = (nodes: OrgNode[], parent: string | null) => {
    for (const n of nodes) {
      byId.set(n.id, n);
      parentOf.set(n.id, parent);
      walk(n.children, n.id);
    }
  };
  walk(tree, null);
  return { byId, parentOf };
}

function idsUpToLevel(nodes: OrgNode[], level: number, out = new Set<string>()) {
  for (const n of nodes) {
    if (n.level < level) out.add(n.id);
    idsUpToLevel(n.children, level, out);
  }
  return out;
}

function loadOffsets(): Record<string, Offset> {
  try {
    return JSON.parse(localStorage.getItem(OFFSETS_KEY) ?? "{}") as Record<string, Offset>;
  } catch {
    return {};
  }
}

function saveOffsets(o: Record<string, Offset>) {
  try {
    localStorage.setItem(OFFSETS_KEY, JSON.stringify(o));
  } catch {
    // Brauzer yaddaşı əlçatan deyil — düzülüş yalnız bu sessiyada qalır
  }
}

/** Brauzerdə yadda saxlanılan görünüş: açıq düyünlər, mərkəz, seçim, miqyas */
const VIEW_KEY = "org-chart-view-v1";

interface ViewSnapshot {
  expanded: string[];
  focus: string | null;
  selected: string | null;
}

interface SavedView extends ViewSnapshot {
  zoom: number;
  pan: Offset;
}

type SearchResult = { type: "staff" | "dept"; id: string };

function loadView(): SavedView | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as SavedView | null;
    return v && Array.isArray(v.expanded) && typeof v.zoom === "number" && v.pan ? v : null;
  } catch {
    return null;
  }
}

function saveView(v: SavedView) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // Brauzer yaddaşı əlçatan deyil
  }
}

/** Nəticənin xəritədəki mərkəz nöqtəsi (əməkdaş — heyət şəbəkəsindəki kartı) */
function locate(placed: Placed[], r: SearchResult): Offset | null {
  if (r.type === "dept") {
    const p = placed.find((x) => x.dept?.id === r.id && (x.kind === "dept" || x.kind === "root"));
    return p ? { x: p.x + p.w / 2, y: p.y + p.h / 2 } : null;
  }
  for (const p of placed) {
    if (p.kind !== "grid") continue;
    const i = p.staff!.findIndex((s) => s.employmentId === r.id);
    if (i < 0) continue;
    const cols = gridCols(p.staff!.length);
    return {
      x: p.x + CHIP.pad + (i % cols) * (CHIP.w + CHIP.gap) + CHIP.w / 2,
      y: p.y + CHIP.pad + Math.floor(i / cols) * (CHIP.h + CHIP.gap) + CHIP.h / 2,
    };
  }
  return null;
}

type DeptDialogState = { mode: "create"; parent: OrgNode | null } | { mode: "edit"; dept: OrgNode } | null;

// ----------------------------------------------------------------------------
//  Komponent
// ----------------------------------------------------------------------------

export function OrgChart({
  tree,
  staff,
  options,
  canEdit,
  canEditStructure,
}: {
  tree: OrgNode[];
  staff: OrgStaff[];
  options: PersonFormOptions;
  canEdit: boolean;
  canEditStructure: boolean;
}) {
  const { byId, parentOf } = useMemo(() => indexTree(tree), [tree]);
  const staffByDept = useMemo(() => {
    const m = new Map<string, OrgStaff[]>();
    for (const s of staff) m.set(s.departmentId, [...(m.get(s.departmentId) ?? []), s]);
    return m;
  }, [staff]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [offsets, setOffsets] = useState<Record<string, Offset>>({});
  const [deptDialog, setDeptDialog] = useState<DeptDialogState>(null);
  const [zoom, setZoom] = useState(0.9);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [restored, setRestored] = useState(false);
  const [historyLen, setHistoryLen] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const panDrag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const nodeDrag = useRef<{ key: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const history = useRef<ViewSnapshot[]>([]);
  /** Düzülüş yeniləndikdən sonra mərkəzə gətiriləcək hədəf */
  const pendingTarget = useRef<SearchResult | null>(null);

  // Kursorun altındakı nöqtə yerində qalmaqla miqyası dəyiş
  const view = useRef({ zoom, pan });
  view.current = { zoom, pan };
  const [instant, setInstant] = useState(false);
  const instantTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const zoomAt = useCallback((next: number, cx?: number, cy?: number, smooth = false) => {
    const el = viewport.current;
    if (!el) return;
    const { zoom: z, pan: p } = view.current;
    const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    if (nz === z) return;
    const x = cx ?? el.clientWidth / 2;
    const y = cy ?? el.clientHeight / 2;
    const np = { x: x - ((x - p.x) * nz) / z, y: y - ((y - p.y) * nz) / z };
    view.current = { zoom: nz, pan: np };
    if (!smooth) {
      setInstant(true);
      clearTimeout(instantTimer.current);
      instantTimer.current = setTimeout(() => setInstant(false), 200);
    }
    setZoom(nz);
    setPan(np);
  }, []);

  // React-in onWheel-i passivdir (preventDefault işləmir) — ona görə native dinləyici
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-panel]")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // Touchpad (kiçik delta) üçün həssaslıq eyni qalsın deyə eksponensial addım
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(view.current.zoom * Math.exp(-dy * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const center = useCallback(() => {
    const el = viewport.current;
    if (el) setPan({ x: el.clientWidth / 2, y: el.clientHeight / 2 });
  }, []);

  // Brauzer yaddaşından bərpa (yalnız hidrasiyadan sonra): düzülüş, açıq düyünlər, seçim, miqyas
  useEffect(() => {
    setOffsets(loadOffsets());
    const v = loadView();
    if (v) {
      setExpanded(new Set(v.expanded));
      setFocus(v.focus);
      setSelected(v.selected);
      setZoom(v.zoom);
      setPan(v.pan);
    } else center();
    setRestored(true);
  }, [center]);

  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => saveView({ expanded: [...expanded], focus, selected, zoom, pan }), 300);
    return () => clearTimeout(t);
  }, [restored, expanded, focus, selected, zoom, pan]);

  const q = norm(query.trim());

  // Axtarış: uyğun bölmələrin və əməkdaşların yolu açılır
  const search = useMemo(() => {
    if (!q) return null;
    const open = new Set<string>();
    const deptHits = new Set<string>();
    const staffHits = new Set<string>();
    const openPath = (id: string | null | undefined) => {
      for (let p = id; p; p = parentOf.get(p)) open.add(p);
    };
    const results: SearchResult[] = [];
    for (const s of staff) {
      if (norm(s.fullName).includes(q) || norm(s.code).includes(q)) {
        staffHits.add(s.employmentId);
        openPath(s.departmentId);
        open.add(`staff:${s.departmentId}`);
        results.push({ type: "staff", id: s.employmentId });
      }
    }
    for (const n of byId.values()) {
      if (norm(n.name).includes(q) || norm(n.code).includes(q)) {
        deptHits.add(n.id);
        openPath(parentOf.get(n.id));
        results.push({ type: "dept", id: n.id });
      }
    }
    return { open, deptHits, staffHits, results };
  }, [q, byId, parentOf, staff]);

  const results = search?.results ?? [];
  const active = results[Math.min(activeIdx, results.length - 1)];
  useEffect(() => setActiveIdx(0), [q]);

  const isOpen = useCallback((key: string) => (search ? search.open.has(key) : expanded.has(key)), [search, expanded]);

  // --- Naviqasiya tarixçəsi ("Geri") ---------------------------------------------
  const pushHistory = () => {
    history.current.push({ expanded: [...(search ? search.open : expanded)], focus, selected });
    if (history.current.length > 50) history.current.shift();
    setHistoryLen(history.current.length);
  };
  const goBack = () => {
    const s = history.current.pop();
    setHistoryLen(history.current.length);
    if (!s) return;
    setQuery("");
    setExpanded(new Set(s.expanded));
    if (s.focus !== focus) center();
    setFocus(s.focus);
    setSelected(s.selected);
  };

  const changeFocus = (id: string | null) => {
    pushHistory();
    setFocus(id);
    center();
  };

  // Axtarış zamanı toggle — nəticədəki açıq düyünlər saxlanılır, axtarış təmizlənir
  const toggleNode = (key: string) => {
    pushHistory();
    setExpanded((prev) => {
      const next = new Set(search ? search.open : prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (search) setQuery("");
  };

  const selectStaff = (id: string) => {
    if (id === selected) return;
    pushHistory();
    setSelected(id);
  };

  /** Axtarış nəticəsini seçmək: yolu açır, əməkdaşı seçir, xəritəni onun üzərinə gətirir */
  const pick = (r: SearchResult) => {
    pushHistory();
    const deptId = r.type === "staff" ? staff.find((s) => s.employmentId === r.id)?.departmentId : r.id;
    if (!deptId) return;
    const path = new Set(expanded);
    for (let p: string | null | undefined = r.type === "staff" ? deptId : parentOf.get(deptId); p; p = parentOf.get(p)) path.add(p);
    if (r.type === "staff") path.add(`staff:${deptId}`);
    // Mərkəzdəki bölmə hədəfi əhatə etmirsə — bütün struktura qayıdılır
    let inside = !focus;
    for (let p: string | null | undefined = deptId; p && !inside; p = parentOf.get(p)) inside = p === focus;
    if (!inside) setFocus(null);
    setExpanded(path);
    if (r.type === "staff") setSelected(r.id);
    setQuery("");
    pendingTarget.current = r;
  };

  // Görünən ağac
  const mapRoot = useMemo((): MapNode => {
    const deptNode = (d: OrgNode, asRoot = false): MapNode => {
      const direct = staffByDept.get(d.id) ?? [];
      const children: MapNode[] = [];
      if (asRoot || isOpen(d.id)) {
        children.push(...d.children.map((c) => deptNode(c)));
        if (direct.length) {
          const staffKey = `staff:${d.id}`;
          const grid = isOpen(staffKey) ? [{ key: `grid:${d.id}`, kind: "grid" as const, staff: direct, children: [], ...gridSize(direct.length) }] : [];
          children.push({ key: staffKey, kind: "staff", dept: d, staff: direct, children: grid, ...SIZE.staff });
        }
      }
      return { key: d.id, kind: asRoot ? "root" : "dept", dept: d, children, ...(asRoot ? SIZE.root : SIZE.dept) };
    };
    const focused = focus ? byId.get(focus) : undefined;
    if (focused) return deptNode(focused, true);
    return { key: "root", kind: "root", children: tree.map((d) => deptNode(d)), ...SIZE.root };
  }, [tree, byId, focus, staffByDept, isOpen]);

  const placed = useMemo(() => layout(mapRoot, offsets), [mapRoot, offsets]);

  /** Nöqtəni ekranın mərkəzinə gətirir; açıq panel varsa, onun eni qədər sola sürüşdürülür */
  const panTo = useCallback(
    (pt: Offset, panelOpen: boolean) => {
      const el = viewport.current;
      if (!el) return;
      const z = Math.max(zoom, 0.8);
      const shift = panelOpen && el.clientWidth > 900 ? 200 : 0;
      setZoom(z);
      setPan({ x: el.clientWidth / 2 - shift - pt.x * z, y: el.clientHeight / 2 - pt.y * z });
    },
    [zoom],
  );

  // Yazdıqca aktiv nəticə xəritədə göstərilir (axtarış açıq ikən yolu artıq düzülüşdədir)
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      const pt = locate(placed, active);
      if (pt) panTo(pt, false);
    }, 150);
    return () => clearTimeout(t);
  }, [active, placed, panTo]);

  // Hədəf düzülüşdə görünən kimi oraya sürüşdürülür
  useEffect(() => {
    const r = pendingTarget.current;
    if (!r) return;
    const pt = locate(placed, r);
    if (!pt) return;
    pendingTarget.current = null;
    panTo(pt, r.type === "staff" && !search);
  });

  const fit = () => {
    const el = viewport.current;
    if (!el) return;
    const minX = Math.min(...placed.map((p) => p.x));
    const maxX = Math.max(...placed.map((p) => p.x + p.w));
    const minY = Math.min(...placed.map((p) => p.y));
    const maxY = Math.max(...placed.map((p) => p.y + p.h));
    const z = Math.min(1.2, Math.max(0.3, Math.min((el.clientWidth - 48) / (maxX - minX), (el.clientHeight - 48) / (maxY - minY))));
    setZoom(z);
    setPan({ x: el.clientWidth / 2 - ((minX + maxX) / 2) * z, y: el.clientHeight / 2 - ((minY + maxY) / 2) * z });
  };

  const setLevel = (level: number) => {
    pushHistory();
    setQuery("");
    setFocus(null);
    setExpanded(idsUpToLevel(tree, level));
    center();
  };

  const resetLayout = () => {
    setOffsets({});
    saveOffsets({});
    center();
  };
  /** Başlanğıc görünüş: yalnız 1-ci səviyyə, sürüşdürmələr sıfır, seçim yox, ekrana sığdırılmış */
  const fitNext = useRef(false);
  const resetFlow = () => {
    pushHistory();
    setQuery("");
    setFocus(null);
    setSelected(null);
    setExpanded(new Set());
    setOffsets({});
    saveOffsets({});
    fitNext.current = true;
  };
  useEffect(() => {
    if (!fitNext.current) return;
    fitNext.current = false;
    fit();
  });

  // Düyünün sürüklənməsi: 4px-dən az hərəkət — klik (aç/bağla)
  const onNodePointerDown = (p: Placed) => (e: React.PointerEvent) => {
    if (p.kind === "root" || (e.target as HTMLElement).closest("button, a, input")) return;
    e.stopPropagation();
    const own = offsets[p.key] ?? { x: 0, y: 0 };
    nodeDrag.current = { key: p.key, sx: e.clientX, sy: e.clientY, ox: own.x, oy: own.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onNodePointerMove = (e: React.PointerEvent) => {
    const d = nodeDrag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / zoom;
    const dy = (e.clientY - d.sy) / zoom;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    d.moved = true;
    setOffsets((prev) => ({ ...prev, [d.key]: { x: d.ox + dx, y: d.oy + dy } }));
  };
  const onNodePointerUp = (p: Placed) => () => {
    const d = nodeDrag.current;
    nodeDrag.current = null;
    if (!d) return;
    if (d.moved) setOffsets((prev) => (saveOffsets(prev), prev));
    else if (p.kind === "dept" || p.kind === "staff") toggleNode(p.key);
  };

  const totals = useMemo(() => tree.reduce((a, n) => ({ units: a.units + n.units, filled: a.filled + n.filled, headcount: a.headcount + n.headcount }), { units: 0, filled: 0, headcount: 0 }), [tree]);
  const selectedStaff = selected ? staff.find((s) => s.employmentId === selected) : undefined;
  const manual = Object.keys(offsets).length > 0;
  const activeStaff = active?.type === "staff" ? active.id : null;
  const activeDept = active?.type === "dept" ? active.id : null;

  if (tree.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
        <NetworkIcon className="size-8" />
        Struktur bölmələri hələ yoxdur
        <div className="flex gap-2">
          {canEditStructure && (
            <Button size="sm" onClick={() => setDeptDialog({ mode: "create", parent: null })}>
              <PlusIcon /> Bölmə əlavə et
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <a href="/import">İdxal mərkəzi</a>
          </Button>
        </div>
        <DeptDialog state={deptDialog} tree={tree} onClose={() => setDeptDialog(null)} onCreated={() => undefined} />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Button variant="outline" size="sm" onClick={goBack} disabled={historyLen === 0} title="Əvvəlki görünüşə qayıt">
          <Undo2Icon /> Geri
        </Button>
        <div className="relative w-full sm:w-80">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (!results.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && active) {
                e.preventDefault();
                pick(active);
              } else if (e.key === "Escape") setQuery("");
            }}
            placeholder="Əməkdaş və ya bölmə axtar…"
            className="pr-8 pl-9"
            aria-label="Əməkdaş və ya bölmə axtar"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Axtarışı təmizlə" className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted">
              <XIcon className="size-3.5" />
            </button>
          )}
          {search && (
            <SearchResults
              results={results}
              active={active}
              staff={staff}
              byId={byId}
              onHover={(i) => setActiveIdx(i)}
              onPick={pick}
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">Səviyyə:</span>
          {[1, 2, 3, 4].map((lvl) => (
            <Button key={lvl} variant="outline" size="sm" onClick={() => setLevel(lvl)} title={`${lvl}-ci səviyyəyədək aç`}>
              {lvl}
            </Button>
          ))}
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground tabular-nums">
          <span>{totals.headcount} əməkdaş</span>
          <span>
            {formatNumber(totals.filled, 1)} / {formatNumber(totals.units, 1)} ştat
          </span>
          <span className="text-warning">{formatNumber(Math.max(0, totals.units - totals.filled), 1)} vakansiya</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {canEditStructure && (
            <Button variant="outline" size="sm" onClick={() => setDeptDialog({ mode: "create", parent: focus ? (byId.get(focus) ?? null) : null })}>
              <PlusIcon /> Bölmə
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={resetFlow} title="Hamısını bağla, düzülüşü sıfırla və ekrana sığdır">
            <RotateCcwIcon /> Flow-u sıfırla
          </Button>
          {manual && (
            <Button variant="ghost" size="sm" onClick={resetLayout} title="Əl ilə dəyişdirilmiş mövqeləri sıfırla">
              <LayoutGridIcon /> Düzülüşü sıfırla
            </Button>
          )}
          <Button variant="outline" size="icon" className="size-8" aria-label="Kiçilt" onClick={() => zoomAt(zoom - 0.1, undefined, undefined, true)}>
            <MinusIcon />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button variant="outline" size="icon" className="size-8" aria-label="Böyüt" onClick={() => zoomAt(zoom + 0.1, undefined, undefined, true)}>
            <PlusIcon />
          </Button>
          <Button variant="outline" size="sm" onClick={fit}>
            <MaximizeIcon /> Ekrana sığdır
          </Button>
        </div>
      </div>

      <div
        ref={viewport}
        className="relative h-[calc(100dvh-230px)] min-h-[480px] cursor-grab touch-none overflow-hidden bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:22px_22px] select-none active:cursor-grabbing"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button, a, input, [data-panel]")) return;
          panDrag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!panDrag.current) return;
          setPan({ x: panDrag.current.px + e.clientX - panDrag.current.x, y: panDrag.current.py + e.clientY - panDrag.current.y });
        }}
        onPointerUp={() => (panDrag.current = null)}
      >
        <div className="absolute top-0 left-0 origin-top-left transition-transform duration-300 ease-out" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transitionDuration: instant || panDrag.current || nodeDrag.current ? "0ms" : undefined }}>
          <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1" aria-hidden>
            {placed
              .filter((p) => p.parent)
              .map((p) => (
                <path
                  key={p.key}
                  d={edgePath(p)}
                  fill="none"
                  stroke={p.color}
                  strokeOpacity={0.55}
                  strokeWidth={p.kind === "grid" ? 1.5 : 2.5}
                  strokeDasharray={p.kind === "grid" || p.kind === "staff" ? "5 5" : undefined}
                />
              ))}
          </svg>
          {placed.map((p) => (
            <div
              key={p.key}
              className={cn("absolute top-0 left-0", p.kind !== "root" && "cursor-pointer active:cursor-grabbing")}
              style={{ width: p.w, height: p.h, transform: `translate(${p.x}px, ${p.y}px)` }}
              onPointerDown={onNodePointerDown(p)}
              onPointerMove={onNodePointerMove}
              onPointerUp={onNodePointerUp(p)}
            >
              {/* Görünmə animasiyası daxili elementdə: xarici transform mövqedir */}
              <div className="h-full animate-in duration-200 fade-in-0">
                {p.kind === "root" ? (
                  <RootCard
                    node={p}
                    totals={totals}
                    onBack={focus ? () => changeFocus(parentOf.get(focus) ?? null) : undefined}
                    onReset={focus ? () => changeFocus(null) : undefined}
                    onAdd={canEditStructure && (!p.dept || p.dept.level < MAX_LEVEL) ? () => setDeptDialog({ mode: "create", parent: p.dept ?? null }) : undefined}
                  />
                ) : p.kind === "dept" ? (
                  <DeptCard
                    node={p}
                    direct={staffByDept.get(p.dept!.id)?.length ?? 0}
                    open={isOpen(p.key)}
                    onToggle={() => toggleNode(p.key)}
                    onFocus={() => changeFocus(p.dept!.id)}
                    onAdd={canEditStructure && p.dept!.level < MAX_LEVEL ? () => setDeptDialog({ mode: "create", parent: p.dept! }) : undefined}
                    onEdit={canEditStructure ? () => setDeptDialog({ mode: "edit", dept: p.dept! }) : undefined}
                    hit={activeDept === p.dept!.id ? "active" : search?.deptHits.has(p.dept!.id) ? "match" : undefined}
                  />
                ) : p.kind === "staff" ? (
                  <StaffGroupCard node={p} open={isOpen(p.key)} />
                ) : (
                  <StaffGrid node={p} selected={selected} active={activeStaff} hits={search?.staffHits} onSelect={selectStaff} />
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted-foreground">
          Kartı sürükləyin — yerini dəyişin · boş sahəni sürükləyin — hərəkət · siçan təkəri — böyüt/kiçilt · görünüş yadda saxlanılır
        </p>

        <AnimatePresence>
          {selectedStaff && (
            <StaffPanel key={selectedStaff.employmentId} staff={selectedStaff} dept={byId.get(selectedStaff.departmentId)} options={options} canEdit={canEdit} onClose={() => setSelected(null)} />
          )}
        </AnimatePresence>
      </div>

      <DeptDialog
        state={deptDialog}
        tree={tree}
        onClose={() => setDeptDialog(null)}
        onCreated={(parentId) => {
          // Yeni bölmə görünsün deyə valideyn açılır
          if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
        }}
      />
    </Card>
  );
}

/** Axtarış nəticələri: yazdıqca aktiv nəticə xəritədə göstərilir, klik və ya Enter — seçir */
function SearchResults({
  results,
  active,
  staff,
  byId,
  onHover,
  onPick,
}: {
  results: SearchResult[];
  active?: SearchResult;
  staff: OrgStaff[];
  byId: Map<string, OrgNode>;
  onHover: (i: number) => void;
  onPick: (r: SearchResult) => void;
}) {
  const shown = results.slice(0, 12);
  return (
    <div className="absolute top-full left-0 z-30 mt-1 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-popover shadow-xl">
      {shown.length === 0 ? (
        <div className="px-3 py-4 text-center text-sm text-muted-foreground">Heç nə tapılmadı</div>
      ) : (
        <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
          {shown.map((r, i) => {
            const s = r.type === "staff" ? staff.find((x) => x.employmentId === r.id) : undefined;
            const d = r.type === "dept" ? byId.get(r.id) : s ? byId.get(s.departmentId) : undefined;
            const isActive = active?.type === r.type && active.id === r.id;
            return (
              <li key={`${r.type}:${r.id}`} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onMouseEnter={() => onHover(i)}
                  onClick={() => onPick(r)}
                  className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left", isActive && "bg-amber-500/15")}
                >
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", s ? (CATEGORY_TONE[s.category] ?? "bg-muted") : "bg-muted text-muted-foreground")}>
                    {s ? initials(s.fullName) : <BuildingIcon className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s ? s.fullName : d?.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{s ? `${s.position} · ${d?.name ?? ""}` : `${d?.code} · ${d ? LEVEL_LABEL[d.level] : ""}`}</span>
                  </span>
                  {isActive && <span className="shrink-0 text-[10px] text-muted-foreground">Enter ↵</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {results.length > shown.length && <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">{results.length} nəticədən 12-si göstərilir</div>}
    </div>
  );
}

// ----------------------------------------------------------------------------
//  Düyün kartları
// ----------------------------------------------------------------------------

function FillBar({ node }: { node: OrgNode }) {
  if (node.units <= 0) return null;
  const vacancy = Math.max(0, node.units - node.filled);
  const over = node.filled > node.units + 1e-9;
  const fill = Math.min(100, (node.filled / node.units) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", over ? "bg-danger" : fill >= 85 ? "bg-success" : "bg-warning")} style={{ width: `${fill}%` }} />
      </div>
      <span className={cn("text-[11px] whitespace-nowrap tabular-nums", over ? "text-danger" : vacancy > 0 ? "text-warning" : "text-success")}>
        {over ? `+${formatNumber(node.filled - node.units, 2)} artıq` : vacancy > 0 ? `${formatNumber(vacancy, 2)} vakansiya` : "dolu"}
      </span>
    </div>
  );
}

/** Düyünün xarici kənarındakı aç/bağla düyməsi */
function ToggleDot({ dir, open, count, color, onClick }: { dir: 1 | -1; open: boolean; count: number; color: string; onClick: () => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? "Bağla" : "Aç"}
      aria-expanded={open}
      className={cn(
        "absolute top-1/2 z-10 flex h-6 min-w-6 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-card px-1 text-[10px] font-bold shadow-sm transition-transform hover:scale-110",
        dir === 1 ? "-right-3" : "-left-3",
      )}
      style={{ borderColor: color, color }}
    >
      {open ? <MinusIcon className="size-3" /> : count}
    </button>
  );
}

/** Kartın üzərinə gələndə görünən kiçik əməliyyat düymələri */
function NodeAction({ label, onClick, children, light }: { label: string; onClick: () => void; children: React.ReactNode; light?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn("rounded-md p-1 transition-colors", light ? "text-white/80 hover:bg-white/20 hover:text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
    >
      {children}
    </button>
  );
}

function RootCard({
  node,
  totals,
  onBack,
  onReset,
  onAdd,
}: {
  node: Placed;
  totals: { units: number; filled: number; headcount: number };
  onBack?: () => void;
  onReset?: () => void;
  onAdd?: () => void;
}) {
  const d = node.dept;
  const t = d ?? totals;
  const vacancy = Math.max(0, t.units - t.filled);
  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-blue-400/30 bg-gradient-to-br from-blue-600 to-indigo-800 p-3.5 text-white shadow-lg shadow-blue-600/25">
      <div className="flex items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
          <Building2Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm leading-tight font-bold">{d ? d.name : "ASOİU"}</div>
          <div className="mt-0.5 text-[11px] text-blue-100">{d ? `${d.code} · ${LEVEL_LABEL[d.level]}` : "Azərbaycan Dövlət Neft və Sənaye Universiteti"}</div>
        </div>
        {onAdd && (
          <NodeAction label={d ? "Alt bölmə əlavə et" : "Yeni 1-ci səviyyə bölmə"} onClick={onAdd} light>
            <PlusIcon className="size-4" />
          </NodeAction>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-blue-100 tabular-nums">
        <span>
          <b className="text-white">{t.headcount}</b> nəfər · <b className="text-white">{formatNumber(vacancy, 1)}</b> vakansiya
        </span>
        {onBack && (
          <span className="flex gap-1">
            <button type="button" onClick={onBack} className="flex items-center gap-1 rounded-md bg-white/15 px-1.5 py-0.5 font-semibold text-white hover:bg-white/25" title="Bir səviyyə yuxarı">
              <ArrowLeftIcon className="size-3" /> Yuxarı
            </button>
            <button type="button" onClick={onReset} className="rounded-md bg-white/15 px-1.5 py-0.5 font-semibold text-white hover:bg-white/25">
              Hamısı
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function DeptCard({
  node,
  direct,
  open,
  onToggle,
  onFocus,
  onAdd,
  onEdit,
  hit,
}: {
  node: Placed;
  direct: number;
  open: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onAdd?: () => void;
  onEdit?: () => void;
  hit?: "match" | "active";
}) {
  const d = node.dept!;
  const Icon = d.isFaculty ? GraduationCapIcon : d.isChair ? LandmarkIcon : d.level === 1 ? BuildingIcon : UsersIcon;
  // Budaq sayı: alt bölmələr + birbaşa heyət düyünü
  const count = d.children.length + (direct > 0 ? 1 : 0);
  return (
    <div className={cn("group relative flex h-full flex-col justify-between rounded-2xl border bg-card p-3 shadow-xs transition-shadow hover:shadow-md", d.closed && "opacity-50", hit === "match" && "ring-2 ring-primary/50", hit === "active" && "bg-amber-500/10 ring-4 ring-amber-400")}>
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${node.color} 14%, transparent)`, color: node.color }}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] leading-tight font-semibold">{d.name}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-mono">{d.code}</span>
            <span className="tabular-nums">{d.headcount} nəfər</span>
            {d.closed && <Badge variant="danger">ləğv</Badge>}
          </div>
        </div>
        <div className="-mt-1 -mr-1 flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <NodeAction label="Mərkəzə gətir" onClick={onFocus}>
            <CrosshairIcon className="size-3.5" />
          </NodeAction>
          {onAdd && (
            <NodeAction label="Alt bölmə əlavə et" onClick={onAdd}>
              <PlusIcon className="size-3.5" />
            </NodeAction>
          )}
          {onEdit && (
            <NodeAction label="Redaktə et" onClick={onEdit}>
              <PencilIcon className="size-3.5" />
            </NodeAction>
          )}
        </div>
      </div>
      <FillBar node={d} />
      <ToggleDot dir={node.dir} open={open} count={count} color={node.color} onClick={onToggle} />
    </div>
  );
}

function StaffGroupCard({ node, open }: { node: Placed; open: boolean }) {
  const list = node.staff!;
  const onLeave = list.filter((s) => s.status === "ON_LEAVE").length;
  return (
    <div
      role="button"
      aria-expanded={open}
      className="relative flex h-full w-full items-center gap-2.5 rounded-xl border border-dashed bg-card/90 px-3 text-left shadow-xs transition-shadow hover:shadow-md"
      style={{ borderColor: node.color }}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${node.color} 14%, transparent)`, color: node.color }}>
        <UsersIcon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold">Heyət · {list.length} nəfər</span>
        <span className="block text-[10px] text-muted-foreground">{onLeave > 0 ? `${onLeave} nəfər məzuniyyətdə` : open ? "bağlamaq üçün klik" : "açmaq üçün klik"}</span>
      </span>
      <span className="text-muted-foreground">{open ? <MinusIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}</span>
    </div>
  );
}

const CATEGORY_TONE: Record<string, string> = {
  "Professor-müəllim": "bg-primary/10 text-primary",
  İnzibati: "bg-chart-4/15 text-chart-4",
  "Tədris-köməkçi": "bg-warning-soft text-warning",
  Xidmətedici: "bg-muted text-muted-foreground",
};

function StaffGrid({ node, selected, active, hits, onSelect }: { node: Placed; selected: string | null; active: string | null; hits?: Set<string>; onSelect: (id: string) => void }) {
  const list = node.staff!;
  return (
    <div
      className="grid h-full cursor-grab content-start rounded-2xl border bg-card/95 shadow-sm"
      style={{ gridTemplateColumns: `repeat(${gridCols(list.length)}, ${CHIP.w}px)`, gap: CHIP.gap, padding: CHIP.pad }}
    >
      {list.map((s) => (
        <button
          key={s.employmentId}
          type="button"
          onClick={() => onSelect(s.employmentId)}
          className={cn(
            "flex items-center gap-2 rounded-lg border border-transparent px-2 text-left transition-colors hover:border-border hover:bg-muted/60",
            hits?.has(s.employmentId) && "ring-2 ring-primary/50",
            // Seçilmiş və ya axtarışda aktiv olan əməkdaş — xüsusi (kəhrəba) rəng
            (selected === s.employmentId || active === s.employmentId) && "border-amber-400 bg-amber-500/15 ring-2 ring-amber-400",
          )}
          style={{ height: CHIP.h }}
        >
          <span className={cn("relative flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", CATEGORY_TONE[s.category] ?? "bg-muted")}>
            {initials(s.fullName)}
            {s.status === "ON_LEAVE" && <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-warning" title="Məzuniyyətdə" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium">{s.fullName.split(" ").slice(0, 2).join(" ")}</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {s.position}
              {!s.isPrimary && " · əvəzçi"}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
//  Struktur bölməsi: əlavə / redaktə / silmə
// ----------------------------------------------------------------------------

const KIND_OPTIONS = [
  { value: "faculty", label: "Fakültə" },
  { value: "chair", label: "Kafedra" },
  { value: "unit", label: "Şöbə / bölmə" },
];

/** Yeni bölmə üçün kod təklifi: valideynin kodu + növbəti sıra nömrəsi (F5 → F5-03) */
function suggestCode(parent: OrgNode | null, tree: OrgNode[]) {
  const siblings = parent ? parent.children : tree;
  const codes = new Set<string>();
  const walk = (ns: OrgNode[]) => ns.forEach((n) => (codes.add(n.code), walk(n.children)));
  walk(tree);
  for (let i = siblings.length + 1; ; i++) {
    const c = parent ? `${parent.code}-${String(i).padStart(2, "0")}` : `B${i}`;
    if (!codes.has(c)) return c;
  }
}

function DeptDialog({ state, tree, onClose, onCreated }: { state: DeptDialogState; tree: OrgNode[]; onClose: () => void; onCreated: (parentId: string | null) => void }) {
  const router = useRouter();
  const [form, formAction, pending] = useActionState<DeptFormState, FormData>(saveDepartmentAction, {});
  const [deleting, startDelete] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const handled = useRef<DeptFormState | null>(null);

  useEffect(() => {
    if (!state) setConfirmDelete(false);
  }, [state]);

  useEffect(() => {
    if (!form.ok || handled.current === form || !state) return;
    handled.current = form;
    toast.success(state.mode === "create" ? "Bölmə əlavə edildi" : "Dəyişikliklər saxlanıldı");
    if (state.mode === "create") onCreated(state.parent?.id ?? null);
    onClose();
    router.refresh();
  }, [form, state, onClose, onCreated, router]);

  if (!state) return null;
  const edit = state.mode === "edit" ? state.dept : null;
  const parent = state.mode === "create" ? state.parent : null;
  const level = edit ? edit.level : parent ? parent.level + 1 : 1;
  const fe = form.ok ? {} : (form.fieldErrors ?? {});
  const defaultKind = edit ? (edit.isFaculty ? "faculty" : edit.isChair ? "chair" : "unit") : level === 1 ? "faculty" : level === 2 ? "chair" : "unit";

  const remove = () =>
    startDelete(async () => {
      const r = await deleteDepartmentAction(edit!.id);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success("Bölmə silindi");
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          key={edit?.id ?? `new-${parent?.id ?? "root"}`}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => formAction(data));
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{edit ? edit.name : "Yeni struktur bölməsi"}</DialogTitle>
            <DialogDescription>
              {edit ? `${LEVEL_LABEL[level]} · ${edit.headcount} nəfər` : parent ? `${parent.name} daxilində · ${LEVEL_LABEL[level]}` : "1-ci səviyyə — fakültə və ya inzibati bölmə"}
            </DialogDescription>
          </DialogHeader>
          {edit && <input type="hidden" name="id" value={edit.id} />}
          {parent && <input type="hidden" name="parentId" value={parent.id} />}
          <FormField label="Adı" htmlFor="dept-name" error={fe.name} required>
            <Input id="dept-name" name="name" defaultValue={edit?.name ?? ""} placeholder={level === 2 ? "məs. Elektroenergetika kafedrası" : "məs. Energetika fakültəsi"} autoFocus />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Kod" htmlFor="dept-code" error={fe.code} required>
              <Input id="dept-code" name="code" defaultValue={edit?.code ?? suggestCode(parent, tree)} className="font-mono" />
            </FormField>
            <FormField label="Yaradılma tarixi" htmlFor="dept-created" error={fe.createdOn} required>
              <Input id="dept-created" name="createdOn" type="date" defaultValue={edit?.createdOn ?? new Date().toISOString().slice(0, 10)} />
            </FormField>
          </div>
          <SelectField name="kind" label="Növü" value={defaultKind} options={KIND_OPTIONS} error={fe.kind} />
          {form.error && !form.ok && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{form.error}</p>}
          <DialogFooter className="sm:justify-between">
            {edit ? (
              confirmDelete ? (
                <Button type="button" variant="destructive" onClick={remove} disabled={deleting}>
                  {deleting ? <LoaderIcon className="animate-spin" /> : <Trash2Icon />} Silməyi təsdiqlə
                </Button>
              ) : (
                <Button type="button" variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)} title="Yalnız boş bölmə silinə bilər">
                  <Trash2Icon /> Sil
                </Button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Ləğv et
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <LoaderIcon className="animate-spin" />} {edit ? "Yadda saxla" : "Əlavə et"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
//  Əməkdaş paneli: məlumat + sürətli redaktə
// ----------------------------------------------------------------------------

function SelectField({ name, label, value, options, error }: { name: string; label: string; value: string; options: { value: string; label: string; hint?: string }[]; error?: string }) {
  const [v, setV] = useState(value);
  return (
    <FormField label={label} htmlFor={name} error={error} required>
      <input type="hidden" name={name} value={v} />
      <Select value={v} onValueChange={setV}>
        <SelectTrigger id={name} className="w-full">
          <SelectValue placeholder="Seçin" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
              {o.hint && <span className="ml-1 text-muted-foreground">· {o.hint}</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

function StaffPanel({ staff: s, dept, options, canEdit, onClose }: { staff: OrgStaff; dept?: OrgNode; options: PersonFormOptions; canEdit: boolean; onClose: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<QuickEditState, FormData>(quickUpdatePersonAction, {});
  const fe = state.ok ? {} : (state.fieldErrors ?? {});

  useEffect(() => {
    if (state.ok) {
      toast.success("Dəyişikliklər saxlanıldı");
      setEditing(false);
      router.refresh();
    } else if (state.error && !state.fieldErrors) toast.error(state.error);
  }, [state, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.aside
      data-panel
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "tween", duration: 0.22 }}
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[400px] cursor-auto flex-col border-l bg-card shadow-2xl select-text"
    >
      <div className="flex items-start gap-3 border-b p-4">
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-bold", CATEGORY_TONE[s.category] ?? "bg-muted")}>{initials(s.fullName)}</span>
        <div className="min-w-0 flex-1">
          <div className="leading-tight font-bold">{s.fullName}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{s.code}</span> · {s.position}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Badge variant="outline">{s.category}</Badge>
            {s.degree && <Badge variant="default">{s.degree}</Badge>}
            {s.title && <Badge variant="default">{s.title}</Badge>}
            {s.status === "ON_LEAVE" && <Badge variant="warning">Məzuniyyətdə</Badge>}
            {!s.isPrimary && <Badge variant="outline">Əvəzçilik</Badge>}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Bağla">
          <XIcon />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!editing ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-muted-foreground">Bölmə</dt>
            <dd>{dept?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">İşə qəbul</dt>
            <dd className="tabular-nums">{formatIsoDate(s.hireDate)}</dd>
            <dt className="text-muted-foreground">Oklad</dt>
            <dd className="tabular-nums">{formatAzn(s.baseSalary)}</dd>
            <dt className="text-muted-foreground">Ştat payı</dt>
            <dd className="tabular-nums">{formatNumber(s.unitShare, 2)}</dd>
            <dt className="text-muted-foreground">Mobil</dt>
            <dd>
              {s.mobilePhone ? (
                <span className="flex items-center gap-1.5">
                  <PhoneIcon className="size-3.5 text-muted-foreground" />
                  {s.mobilePhone}
                </span>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-muted-foreground">Xidməti</dt>
            <dd>{s.workPhone ?? "—"}</dd>
            <dt className="text-muted-foreground">E-poçt</dt>
            <dd className="min-w-0 break-all">
              {s.email ? (
                <span className="flex items-center gap-1.5">
                  <MailIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  {s.email}
                </span>
              ) : (
                "—"
              )}
            </dd>
          </dl>
        ) : (
          <form
            id="quick-edit"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              startTransition(() => formAction(data));
            }}
            className="flex flex-col gap-3"
          >
            <input type="hidden" name="personId" value={s.personId} />
            <input type="hidden" name="employmentId" value={s.employmentId} />
            <SelectField name="departmentId" label="Struktur bölmə" value={s.departmentId} options={options.departments} error={fe.departmentId} />
            <SelectField name="positionId" label="Vəzifə" value={s.positionId} options={options.positions} error={fe.positionId} />
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Oklad (₼)" htmlFor="baseSalary" error={fe.baseSalary} required>
                <Input id="baseSalary" name="baseSalary" type="number" step="0.01" min="0" defaultValue={s.baseSalary} />
              </FormField>
              <FormField label="Ştat payı" htmlFor="unitShare" error={fe.unitShare} required>
                <Input id="unitShare" name="unitShare" type="number" step="0.25" min="0.25" max="2" defaultValue={s.unitShare} />
              </FormField>
            </div>
            <SelectField
              name="status"
              label="Status"
              value={s.status}
              options={[
                { value: "ACTIVE", label: "Aktiv" },
                { value: "ON_LEAVE", label: "Məzuniyyətdə" },
              ]}
              error={fe.status}
            />
            <FormField label="Mobil telefon" htmlFor="mobilePhone" error={fe.mobilePhone}>
              <Input id="mobilePhone" name="mobilePhone" defaultValue={s.mobilePhone ?? ""} placeholder="+994 50 000 00 00" />
            </FormField>
            <FormField label="Xidməti telefon" htmlFor="workPhone" error={fe.workPhone}>
              <Input id="workPhone" name="workPhone" defaultValue={s.workPhone ?? ""} />
            </FormField>
            <FormField label="E-poçt" htmlFor="email" error={fe.email}>
              <Input id="email" name="email" type="email" defaultValue={s.email ?? ""} />
            </FormField>
            {state.error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
            <p className="text-[11px] text-muted-foreground">Oklad dəyişəndə maaş tarixçəsinə yeni qeyd əlavə olunur. Bütün dəyişikliklər audit jurnalına yazılır.</p>
          </form>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t p-3">
        {editing ? (
          <>
            <Button type="submit" form="quick-edit" disabled={pending}>
              {pending && <LoaderIcon className="animate-spin" />} Yadda saxla
            </Button>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={pending}>
              Ləğv et
            </Button>
          </>
        ) : (
          <>
            {canEdit && (
              <Button onClick={() => setEditing(true)}>
                <PencilIcon /> Redaktə et
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href={`/employees/${s.personId}`}>
                <ExternalLinkIcon /> Dosye
              </Link>
            </Button>
            {canEdit && (
              <Button variant="ghost" asChild>
                <Link href={`/employees/${s.personId}/edit`}>Tam forma</Link>
              </Button>
            )}
          </>
        )}
      </div>
    </motion.aside>
  );
}
