export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000]

export function isBusyError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /\[(500|503)\b|high demand|overloaded|unavailable|timed out/i.test(msg)
}

export async function withBusyRetry<T>(
  call: () => Promise<T>,
  onRetry: (attempt: number, waitMs: number) => void = () => {},
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call()
    } catch (e) {
      const waitMs = RETRY_DELAYS_MS[attempt]
      if (waitMs === undefined || !isBusyError(e)) throw e
      onRetry(attempt + 1, waitMs)
      await sleep(waitMs)
    }
  }
}
