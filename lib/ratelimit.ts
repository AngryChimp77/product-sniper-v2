import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Single shared Redis instance using recommended Upstash helper
const redis = Redis.fromEnv();

export const IP_LIMITER = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 s"),
});

export const USER_LIMITER = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "60 s"),
});

