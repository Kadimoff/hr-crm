"use client";

import type { ImportStage } from "@prisma/client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BatchSnapshot } from "@/lib/import-snapshot";

export interface StageProgress {
  processed: number;
  total: number;
  valid: number;
  invalid: number;
}

export interface LogEntry {
  at: number;
  tone: "info" | "success" | "warning" | "error";
  message: string;
}

type ServerEvent =
  | { type: "phase"; phase: "parse" | "validate" | "commit"; message: string; at: number }
  | { type: "file"; fileName: string; sheet: string; rows: number; at: number }
  | ({ type: "stage"; stage: ImportStage; at: number } & StageProgress)
  | { type: "commit"; stage: ImportStage; committed: number; total: number; at: number }
  | { type: "status"; status: BatchSnapshot["status"]; at: number }
  | { type: "error"; message: string; at: number };

/** Batch snapshot-u + SSE ilə canlı irəliləyiş */
export function useBatch(batchId: string | null) {
  const [snapshot, setSnapshot] = useState<BatchSnapshot | null>(null);
  const [phase, setPhase] = useState<"parse" | "validate" | "commit" | null>(null);
  const [stageProgress, setStageProgress] = useState<Partial<Record<ImportStage, StageProgress>>>({});
  const [commitProgress, setCommitProgress] = useState<Partial<Record<ImportStage, { committed: number; total: number }>>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!batchId) return;
    const res = await fetch(`/api/import/${batchId}`, { cache: "no-store" });
    if (res.ok) setSnapshot((await res.json()) as BatchSnapshot);
  }, [batchId]);

  /** Hadisə seli zamanı snapshot-u çox tez-tez çəkməmək üçün */
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, 400);
  }, [refresh]);

  useEffect(() => {
    if (!batchId) return;
    setStageProgress({});
    setCommitProgress({});
    setLog([]);
    void refresh();

    const es = new EventSource(`/api/import/${batchId}/events`);
    const push = (entry: Omit<LogEntry, "at">) => setLog((l) => [...l.slice(-79), { ...entry, at: Date.now() }]);

    es.addEventListener("ready", () => setConnected(true));
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      const ev = JSON.parse(msg.data) as ServerEvent;
      switch (ev.type) {
        case "phase":
          setPhase(ev.phase);
          if (ev.phase === "commit") setCommitProgress({});
          if (ev.phase === "validate") setStageProgress({});
          push({ tone: "info", message: ev.message });
          break;
        case "file":
          push({ tone: "info", message: `${ev.fileName} → "${ev.sheet}": ${ev.rows} sətir` });
          break;
        case "stage":
          setStageProgress((p) => ({ ...p, [ev.stage]: { processed: ev.processed, total: ev.total, valid: ev.valid, invalid: ev.invalid } }));
          scheduleRefresh();
          break;
        case "commit":
          setCommitProgress((p) => ({ ...p, [ev.stage]: { committed: ev.committed, total: ev.total } }));
          break;
        case "status":
          push({
            tone: ev.status === "FAILED" ? "error" : ev.status === "NEEDS_REVIEW" ? "warning" : ev.status === "COMPLETED" || ev.status === "READY" ? "success" : "info",
            message: `Status: ${ev.status}`,
          });
          if (["READY", "NEEDS_REVIEW", "COMPLETED", "FAILED"].includes(ev.status)) setPhase(null);
          void refresh();
          break;
        case "error":
          push({ tone: "error", message: ev.message });
          break;
      }
    };
    return () => {
      es.close();
      clearTimeout(refreshTimer.current);
    };
  }, [batchId, refresh, scheduleRefresh]);

  return { snapshot, refresh, phase, stageProgress, commitProgress, log, connected };
}
