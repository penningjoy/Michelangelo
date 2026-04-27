/**
 * Portable cache with three swappable backends, picked by the CACHE_DRIVER env:
 *   - "memory" (default): in-process LRU map. Survives until the process exits.
 *   - "postgres": uses the existing Postgres pool + cache_kv table. Survives
 *     restarts and works across processes. Picked automatically when
 *     CACHE_DRIVER is unset and a Postgres pool is available, unless the user
 *     explicitly sets CACHE_DRIVER=memory.
 *   - "redis": lazy-loaded redis client (works with local Redis, Upstash, or
 *     any wire-compatible service). Requires CACHE_DRIVER=redis and REDIS_URL.
 *
 * The interface is intentionally tiny so the rest of the app can stay
 * unaware of which backend is in use.
 */
import type { Pool } from "pg";
import { getPoolIfAvailable } from "./storage";
import { getServerEnv } from "./serverEnv";

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Convenience: return cached value or compute, store, and return it. */
  getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T>;
}

let cached: Cache | null = null;

export function getCache(): Cache {
  if (cached) return cached;
  const driver = (getServerEnv("CACHE_DRIVER") || "").toLowerCase();
  if (driver === "redis") {
    cached = makeRedisCache();
  } else if (driver === "postgres") {
    cached = makePostgresCache();
  } else if (driver === "memory") {
    cached = makeMemoryCache();
  } else {
    // Auto-select: prefer Postgres when a pool is available (so cache survives
    // restarts and works across processes), otherwise memory.
    cached = getPoolIfAvailable() ? makePostgresCache() : makeMemoryCache();
  }
  return cached;
}

/** For tests: drop the cached singleton so the next getCache() re-resolves. */
export function resetCacheForTests(): void {
  cached = null;
}

function withGetOrSet(base: Omit<Cache, "getOrSet">): Cache {
  return {
    ...base,
    async getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
      const hit = await base.get<T>(key);
      if (hit !== null) return hit;
      const value = await loader();
      await base.set(key, value, ttlSeconds).catch(() => undefined);
      return value;
    }
  };
}

// ---------- memory backend ----------

const MEMORY_MAX_ENTRIES = 5_000;

function makeMemoryCache(): Cache {
  const store = new Map<string, { value: unknown; expiresAt: number }>();

  const evictExpired = () => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
  };

  return withGetOrSet({
    async get<T>(key: string): Promise<T | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      // LRU touch: re-insert to move to the end of insertion order.
      store.delete(key);
      store.set(key, entry);
      return entry.value as T;
    },
    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      if (store.size >= MEMORY_MAX_ENTRIES) {
        evictExpired();
        if (store.size >= MEMORY_MAX_ENTRIES) {
          // Evict the oldest entry (first key in insertion order).
          const oldest = store.keys().next().value;
          if (oldest !== undefined) store.delete(oldest);
        }
      }
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async del(key: string): Promise<void> {
      store.delete(key);
    }
  });
}

// ---------- postgres backend ----------

function makePostgresCache(): Cache {
  // Light bookkeeping: sweep expired rows occasionally (1 in ~50 writes) so
  // the table doesn't grow without bound. Avoids needing a cron.
  let writeCount = 0;
  const sweep = async (pool: Pool) => {
    try {
      await pool.query("delete from cache_kv where expires_at <= now()");
    } catch {
      // ignore — sweep is best-effort
    }
  };

  return withGetOrSet({
    async get<T>(key: string): Promise<T | null> {
      const pool = getPoolIfAvailable();
      if (!pool) return null;
      try {
        const result = await pool.query<{ value: T }>(
          "select value from cache_kv where key = $1 and expires_at > now()",
          [key]
        );
        return result.rows[0]?.value ?? null;
      } catch {
        return null;
      }
    },
    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      const pool = getPoolIfAvailable();
      if (!pool) return;
      try {
        await pool.query(
          `insert into cache_kv (key, value, expires_at)
             values ($1, $2::jsonb, now() + ($3 || ' seconds')::interval)
           on conflict (key) do update set
             value = excluded.value,
             expires_at = excluded.expires_at`,
          [key, JSON.stringify(value), String(ttlSeconds)]
        );
        writeCount += 1;
        if (writeCount % 50 === 0) void sweep(pool);
      } catch {
        // ignore — cache failures must never break a request
      }
    },
    async del(key: string): Promise<void> {
      const pool = getPoolIfAvailable();
      if (!pool) return;
      try {
        await pool.query("delete from cache_kv where key = $1", [key]);
      } catch {
        // ignore
      }
    }
  });
}

// ---------- redis backend ----------

type MinimalRedis = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  connect(): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
};

function makeRedisCache(): Cache {
  const url = getServerEnv("REDIS_URL");
  if (!url) {
    console.warn("[cache] CACHE_DRIVER=redis but REDIS_URL is unset; falling back to memory.");
    return makeMemoryCache();
  }

  let clientPromise: Promise<MinimalRedis> | null = null;
  const getClient = async (): Promise<MinimalRedis> => {
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
      // Lazy import: only load redis when actually used, so the dependency
      // stays optional in package.json. The dynamic specifier avoids TS
      // resolution at compile time when the package isn't installed.
      const specifier = "redis";
      const mod = (await import(
        /* webpackIgnore: true */ /* @vite-ignore */ specifier
      )) as {
        createClient: (opts: { url: string }) => MinimalRedis;
      };
      const client = mod.createClient({ url });
      client.on("error", (err) => console.warn("[cache] redis error:", err));
      await client.connect();
      return client;
    })();
    return clientPromise;
  };

  return withGetOrSet({
    async get<T>(key: string): Promise<T | null> {
      try {
        const client = await getClient();
        const raw = await client.get(key);
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        return null;
      }
    },
    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      try {
        const client = await getClient();
        await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
      } catch {
        // ignore
      }
    },
    async del(key: string): Promise<void> {
      try {
        const client = await getClient();
        await client.del(key);
      } catch {
        // ignore
      }
    }
  });
}

// ---------- key helpers ----------

/**
 * Stable hash for cache keys. Avoids importing Node crypto at module-eval time
 * when not needed (esp. for edge-incompatible code paths down the line).
 */
export async function hashKey(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}
