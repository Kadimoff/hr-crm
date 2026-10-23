import IORedis, { type RedisOptions } from "ioredis";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";

/** BullMQ blocking əlaqələri üçün maxRetriesPerRequest = null tələb olunur */
const options: RedisOptions = { maxRetriesPerRequest: null, enableReadyCheck: false };

export function createRedis(): IORedis {
  return new IORedis(url, options);
}

const globalForRedis = globalThis as unknown as { redisPub?: IORedis };

/** Publish üçün paylaşılan əlaqə (subscribe üçün hər SSE müştərisi öz əlaqəsini açır) */
export function redisPublisher(): IORedis {
  if (!globalForRedis.redisPub) globalForRedis.redisPub = createRedis();
  return globalForRedis.redisPub;
}
