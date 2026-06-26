// Pub/sub for SSE. Uses Redis when REDIS_URL is set (so multiple app instances
// share events); otherwise an in-process EventEmitter handles a single instance.
import { EventEmitter } from "node:events";

const g = globalThis as unknown as { __bus?: EventEmitter; __redisInit?: boolean };
const bus = g.__bus ?? (g.__bus = new EventEmitter());
bus.setMaxListeners(0);

const CHANNEL = "vault:events";
let publisher: { publish(channel: string, message: string): Promise<unknown> } | null = null;

if (process.env.REDIS_URL && !g.__redisInit) {
  g.__redisInit = true;
  // Dynamic import so ioredis is only loaded when actually configured.
  import("ioredis")
    .then(({ default: Redis }) => {
      publisher = new Redis(process.env.REDIS_URL as string);
      const subscriber = new Redis(process.env.REDIS_URL as string);
      subscriber.subscribe(CHANNEL).catch(() => {});
      subscriber.on("message", (_channel, payload) => {
        try {
          const { userId, event } = JSON.parse(payload);
          bus.emit(userId, event);
        } catch {
          /* ignore malformed */
        }
      });
    })
    .catch(() => {});
}

export function publish(userId: string, event: unknown) {
  if (publisher) {
    publisher.publish(CHANNEL, JSON.stringify({ userId, event })).catch(() => {});
  } else {
    // single-instance (or Redis not ready yet): emit locally
    bus.emit(userId, event);
  }
}

export function subscribe(userId: string, fn: (event: unknown) => void): () => void {
  bus.on(userId, fn);
  return () => bus.off(userId, fn);
}
