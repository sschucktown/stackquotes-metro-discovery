export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RateLimiter {
  private lastRunAt = 0;
  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRunAt;
    const remaining = this.minIntervalMs - elapsed;
    if (remaining > 0) await sleep(remaining);
    this.lastRunAt = Date.now();
  }
}

