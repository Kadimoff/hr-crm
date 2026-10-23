import type { ImportBatchStatus, ImportStage } from "@prisma/client";
import { redisPublisher } from "../redis";

export type ImportEvent =
  | { type: "phase"; phase: "parse" | "validate" | "commit"; message: string }
  | { type: "file"; fileId: string; fileName: string; sheet: string; rows: number }
  | { type: "stage"; stage: ImportStage; processed: number; total: number; valid: number; invalid: number }
  | { type: "commit"; stage: ImportStage; committed: number; total: number }
  | { type: "status"; status: ImportBatchStatus }
  | { type: "error"; message: string };

export const batchChannel = (batchId: string) => `import:batch:${batchId}`;

export async function emit(batchId: string, event: ImportEvent): Promise<void> {
  await redisPublisher().publish(batchChannel(batchId), JSON.stringify({ ...event, at: Date.now() }));
}
