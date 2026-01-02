import type { SocketAddress } from "bun";
import { logInfo, logWarn } from "./logger";

// Rate limit configuration
const LIMITS = {
  anonymous: {
    totalSlides: 3, // Lifetime limit for anonymous users
    throttleMs: 10_000, // 10 seconds between requests
  },
};

const RATE_LIMITED_ENDPOINTS = new Set([
  "POST /api/generate",
  "POST /api/voice-message",
  "POST /api/import",
]);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number | null;
  error?: string;
}

interface RateLimitStore {
  check(fingerprint: string): Promise<RateLimitResult>;
  increment(fingerprint: string): Promise<void>;
}

// In-memory store for development
class InMemoryStore implements RateLimitStore {
  private data = new Map<string, { count: number; lastRequest: number }>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Clean up stale entries every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  private cleanup() {
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
    for (const [key, value] of this.data) {
      if (now - value.lastRequest > staleThreshold) {
        this.data.delete(key);
      }
    }
  }

  async check(fingerprint: string): Promise<RateLimitResult> {
    const entry = this.data.get(fingerprint);
    const now = Date.now();

    if (!entry) {
      return {
        allowed: true,
        remaining: LIMITS.anonymous.totalSlides,
        resetAt: null,
      };
    }

    // Check throttle (time between requests)
    const timeSinceLastRequest = now - entry.lastRequest;
    if (timeSinceLastRequest < LIMITS.anonymous.throttleMs) {
      const resetAt = entry.lastRequest + LIMITS.anonymous.throttleMs;
      return {
        allowed: false,
        remaining: Math.max(0, LIMITS.anonymous.totalSlides - entry.count),
        resetAt,
        error: "Please wait before making another request.",
      };
    }

    // Check total limit
    if (entry.count >= LIMITS.anonymous.totalSlides) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: null,
        error: "Rate limit exceeded. Create an account for more slides.",
      };
    }

    return {
      allowed: true,
      remaining: LIMITS.anonymous.totalSlides - entry.count,
      resetAt: null,
    };
  }

  async increment(fingerprint: string): Promise<void> {
    const entry = this.data.get(fingerprint);
    const now = Date.now();

    if (entry) {
      entry.count += 1;
      entry.lastRequest = now;
    } else {
      this.data.set(fingerprint, { count: 1, lastRequest: now });
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
  }
}

// Redis store for production (Upstash)
class RedisStore implements RateLimitStore {
  private redis: import("@upstash/redis").Redis;

  constructor(redisUrl: string) {
    // Dynamic import to avoid requiring redis in development
    const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
    this.redis = Redis.fromEnv();
  }

  async check(fingerprint: string): Promise<RateLimitResult> {
    const now = Date.now();
    const countKey = `anon:${fingerprint}:count`;
    const throttleKey = `anon:${fingerprint}:throttle`;

    // Check throttle
    const lastRequest = await this.redis.get<number>(throttleKey);
    if (lastRequest) {
      const timeSinceLastRequest = now - lastRequest;
      if (timeSinceLastRequest < LIMITS.anonymous.throttleMs) {
        const count = (await this.redis.get<number>(countKey)) || 0;
        return {
          allowed: false,
          remaining: Math.max(0, LIMITS.anonymous.totalSlides - count),
          resetAt: lastRequest + LIMITS.anonymous.throttleMs,
          error: "Please wait before making another request.",
        };
      }
    }

    // Check total count
    const count = (await this.redis.get<number>(countKey)) || 0;
    if (count >= LIMITS.anonymous.totalSlides) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: null,
        error: "Rate limit exceeded. Create an account for more slides.",
      };
    }

    return {
      allowed: true,
      remaining: LIMITS.anonymous.totalSlides - count,
      resetAt: null,
    };
  }

  async increment(fingerprint: string): Promise<void> {
    const now = Date.now();
    const countKey = `anon:${fingerprint}:count`;
    const throttleKey = `anon:${fingerprint}:throttle`;

    // Increment count (no expiry - lifetime limit)
    await this.redis.incr(countKey);

    // Set throttle timestamp with TTL
    await this.redis.set(throttleKey, now, {
      ex: Math.ceil(LIMITS.anonymous.throttleMs / 1000),
    });
  }
}

// Rate limiter factory
export function createRateLimiter(): RateLimitStore {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;

  if (redisUrl) {
    logInfo("Rate limiter using Redis store", { url: redisUrl.substring(0, 30) + "..." });
    return new RedisStore(redisUrl);
  }

  logInfo("Rate limiter using in-memory store (development mode)");
  return new InMemoryStore();
}

// Extract client fingerprint from request
export function extractFingerprint(
  req: Request,
  clientIP: SocketAddress | null
): string {
  // Get IP from various sources (proxies, CDNs, direct)
  const ip =
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    req.headers.get("X-Real-IP") ||
    clientIP?.address ||
    "unknown";

  const ua = req.headers.get("User-Agent") || "unknown";

  // Create fingerprint hash
  const raw = `${ip}:${ua}`;
  return Bun.hash(raw).toString(16);
}

// Check if endpoint should be rate limited
export function isRateLimitedEndpoint(method: string, pathname: string): boolean {
  const normalizedPath = pathname.replace(/\/+$/, "");
  const key = `${method} ${normalizedPath}`;
  return RATE_LIMITED_ENDPOINTS.has(key);
}

// Main rate limiter class
export class RateLimiter {
  private store: RateLimitStore;

  constructor() {
    this.store = createRateLimiter();
  }

  async check(
    req: Request,
    clientIP: SocketAddress | null
  ): Promise<RateLimitResult> {
    const fingerprint = extractFingerprint(req, clientIP);
    const result = await this.store.check(fingerprint);

    if (!result.allowed) {
      logWarn("Rate limit exceeded", {
        fingerprint: fingerprint.substring(0, 8) + "...",
        remaining: result.remaining,
        error: result.error,
      });
    }

    return result;
  }

  async increment(req: Request, clientIP: SocketAddress | null): Promise<void> {
    const fingerprint = extractFingerprint(req, clientIP);
    await this.store.increment(fingerprint);

    logInfo("Rate limit incremented", {
      fingerprint: fingerprint.substring(0, 8) + "...",
    });
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();
