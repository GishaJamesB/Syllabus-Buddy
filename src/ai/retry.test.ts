import { describe, expect, it, vi } from 'vitest'
import { isBusyError, RETRY_DELAYS_MS, withBusyRetry } from './retry'

const busy = new Error('AI: Error fetching from https://x/models/m:generateContent: [500 ] This model is currently experiencing high demand.')
const noSleep = () => Promise.resolve()

describe('withBusyRetry', () => {
  it('recognises busy errors and ignores others', () => {
    expect(isBusyError(busy)).toBe(true)
    expect(isBusyError(new Error('[503 ] Service Unavailable'))).toBe(true)
    expect(isBusyError(new Error('Buddy timed out'))).toBe(true)
    expect(isBusyError(new Error('[400 ] Bad request'))).toBe(false)
  })

  it('retries busy errors and returns the first success', async () => {
    const call = vi.fn().mockRejectedValueOnce(busy).mockRejectedValueOnce(busy).mockResolvedValue('ok')
    const onRetry = vi.fn()
    await expect(withBusyRetry(call, onRetry, noSleep)).resolves.toBe('ok')
    expect(call).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, RETRY_DELAYS_MS[0])
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, RETRY_DELAYS_MS[1])
  })

  it('gives up after the last delay and rethrows', async () => {
    const call = vi.fn().mockRejectedValue(busy)
    await expect(withBusyRetry(call, () => {}, noSleep)).rejects.toBe(busy)
    expect(call).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1)
  })

  it('does not retry other errors', async () => {
    const bad = new Error('[400 ] Bad request')
    const call = vi.fn().mockRejectedValue(bad)
    await expect(withBusyRetry(call, () => {}, noSleep)).rejects.toBe(bad)
    expect(call).toHaveBeenCalledTimes(1)
  })
})
