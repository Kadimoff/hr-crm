/**
 * BullMQ idxal worker-i — Next.js serverindən ayrı prosesdə işləyir:
 *   npm run worker
 */
import { Worker } from "bullmq";
import { prisma } from "../lib/db";
import { emit } from "../lib/etl/progress";
import { runCommit, runValidation } from "../lib/etl/pipeline";
import { IMPORT_QUEUE, type ImportJobData } from "../lib/queue";
import { createRedis } from "../lib/redis";
import { applyDueDepartmentChanges } from "../lib/department-changes";

const worker = new Worker<ImportJobData>(
  IMPORT_QUEUE,
  async (job) => {
    const { batchId } = job.data;
    try {
      switch (job.data.kind) {
        case "validate":
          await runValidation(prisma, batchId);
          break;
        case "commit":
          await runCommit(prisma, batchId, false, job.data.actorId);
          break;
        case "revalidate-commit":
          await runCommit(prisma, batchId, true, job.data.actorId);
          break;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await prisma.importBatch.update({ where: { id: batchId }, data: { status: "FAILED" } });
      await emit(batchId, { type: "error", message });
      await emit(batchId, { type: "status", status: "FAILED" });
      throw e;
    }
  },
  // Topoloji ardıcıllıq və ştat limitləri üçün işlər ardıcıl icra olunur
  { connection: createRedis(), concurrency: 1 },
);

worker.on("ready", () => console.log(`[import-worker] "${IMPORT_QUEUE}" növbəsi dinlənilir`));

// Gələcək tarixə planlaşdırılmış struktur dəyişiklikləri (TZ M01-01): tarixi çatanlar saatda bir tətbiq olunur
// (struktur səhifələri açılanda da yoxlanılır). Tətbiq oluna bilməyən (məs. aktiv müqavilə qalıb) gözləməkdə qalır.
const applyPlanned = () =>
  applyDueDepartmentChanges(prisma)
    .then((r) => r.applied && console.log(`[import-worker] planlaşdırılmış struktur dəyişiklikləri: ${r.applied} tətbiq olundu, ${r.waiting} gözləyir`))
    .catch((e) => console.error("[import-worker] struktur dəyişiklikləri:", e instanceof Error ? e.message : e));
setTimeout(applyPlanned, 10_000);
const plannedTimer = setInterval(applyPlanned, 60 * 60 * 1000);
worker.on("completed", (job) => console.log(`[import-worker] ${job.data.kind} ${job.data.batchId} tamamlandı`));
worker.on("failed", (job, err) => console.error(`[import-worker] ${job?.data.kind} ${job?.data.batchId} uğursuz:`, err.message));

async function shutdown() {
  clearInterval(plannedTimer);
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
