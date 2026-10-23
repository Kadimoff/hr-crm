import { apiUser } from "@/lib/auth/session";
import { batchChannel } from "@/lib/etl/progress";
import { createRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-Sent Events: worker-in Redis pub/sub hadisələrini brauzerə ötürür */
export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const user = await apiUser("import");
  if (user instanceof Response) return user;
  const { batchId } = await params;
  const sub = createRedis();
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // axın artıq bağlanıb
        }
      };
      sub.on("message", (_channel, message) => send(`data: ${message}\n\n`));
      await sub.subscribe(batchChannel(batchId));
      send(`event: ready\ndata: {}\n\n`);
      // Proksilərin boş əlaqəni bağlamaması üçün
      heartbeat = setInterval(() => send(`: ping\n\n`), 15_000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        sub.disconnect();
        try {
          controller.close();
        } catch {
          // artıq bağlanıb
        }
      });
    },
    cancel() {
      clearInterval(heartbeat);
      sub.disconnect();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
