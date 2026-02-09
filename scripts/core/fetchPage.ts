import { RateLimiter, sleep } from "./rateLimit.js";

export type FetchResult = {
  ok: boolean;
  status: number;
  url: string;
  html?: string;
  error?: string;
};

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export async function fetchHtml(
  url: string,
  limiter: RateLimiter,
  opts?: { timeoutMs?: number; maxRetries?: number; userAgent?: string }
): Promise<FetchResult> {
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const maxRetries = opts?.maxRetries ?? 2;
  const userAgent = opts?.userAgent ?? DEFAULT_UA;

  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt++;
    try {
      await limiter.wait();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: "GET",
        headers: {
          "user-agent": userAgent,
          "accept": "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9,es;q=0.7",
          "cache-control": "no-cache",
          pragma: "no-cache"
        },
        redirect: "follow",
        signal: controller.signal
      });

      clearTimeout(timer);

      const status = res.status;
      const finalUrl = res.url;

      if (!res.ok) {
        // Retry on 429/5xx
        if ((status === 429 || status >= 500) && attempt <= maxRetries) {
          await sleep(500 * attempt);
          continue;
        }
        return { ok: false, status, url: finalUrl, error: `HTTP ${status}` };
      }

      const html = await res.text();
      return { ok: true, status, url: finalUrl, html };
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? "timeout" : String(e?.message ?? e);
      if (attempt <= maxRetries) {
        await sleep(500 * attempt);
        continue;
      }
      return { ok: false, status: 0, url, error: msg };
    }
  }

  return { ok: false, status: 0, url, error: "unknown error" };
}


