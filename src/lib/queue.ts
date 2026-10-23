import { Queue } from "bullmq";
import { createRedis } from "./redis";

export const IMPORT_QUEUE = "hr-import";

export type ImportJobData =
  | { kind: "validate"; batchId: string }
  | { kind: "commit"; batchId: string }
  | { kind: "revalidate-commit"; batchId: string };

const globalForQueue = globalThis as unknown as { importQueue?: Queue<ImportJobData> };

export function importQueue(): Queue<ImportJobData> {
  if (!globalForQueue.importQueue) {
    globalForQueue.importQueue = new Queue<ImportJobData>(IMPORT_QUEUE, {
      connection: createRedis(),
      defaultJobOptions: { attempts: 1, removeOnComplete: 200, removeOnFail: 500 },
    });
  }
  return globalForQueue.importQueue;
}

export async function enqueueImport(data: ImportJobData) {
  // Worker concurrency = 1 olduğundan eyni batch-ın işləri ardıcıl icra olunur
  return importQueue().add(data.kind, data, { jobId: `${data.batchId}:${data.kind}:${Date.now()}` });
}
