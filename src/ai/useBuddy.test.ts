import { describe, expect, it, vi } from 'vitest'
import type { InferenceModeValue } from '../firebase/config'
import type { OnDeviceStatus } from './onDeviceStatus'
import { brainRow, createBuddyService, usesCloud, type BrainStatus, type BuddyBackend } from './useBuddy'

const ready = (mode: InferenceModeValue, nano: OnDeviceStatus, download: number | null = null): BrainStatus => ({
  phase: 'ready',
  mode,
  nano,
  download,
})

describe('brainRow and usesCloud', () => {
  const cases: [BrainStatus, string, string, boolean, boolean][] = [
    [{ phase: 'starting' }, 'starting', 'Waking Buddy up…', false, false],
    [{ phase: 'resting' }, 'resting', 'Buddy is resting', false, false],
    [ready('only_in_cloud', 'available'), 'cloud', '☁️ Using the cloud', false, true],
    [ready('prefer_in_cloud', 'available'), 'cloud', '☁️ Using the cloud', false, true],
    [ready('prefer_on_device', 'available'), 'device', '🔒 Ready on this device', false, false],
    [ready('prefer_on_device', 'downloading', 0.42), 'downloading', 'Downloading 42%', false, true],
    [ready('prefer_on_device', 'downloading'), 'downloading', 'Downloading…', false, true],
    [ready('only_on_device', 'downloading'), 'downloading', 'Downloading…', false, false],
    [ready('prefer_on_device', 'downloadable'), 'cloud', '☁️ Using the cloud', true, true],
    [ready('only_on_device', 'downloadable'), 'needs_device', 'Needs on-device Buddy', true, false],
    [ready('only_on_device', 'unavailable'), 'needs_device', 'Needs on-device Buddy', false, false],
    [ready('prefer_on_device', 'unavailable'), 'cloud', '☁️ Using the cloud', false, true],
    [ready('only_on_device', 'mystery' as OnDeviceStatus), 'needs_device', 'Needs on-device Buddy', false, false],
    [ready('prefer_on_device', 'mystery' as OnDeviceStatus), 'cloud', '☁️ Using the cloud', false, true],
  ]

  it.each(cases)('%j', (status, kind, label, canDownload, cloud) => {
    const row = brainRow(status)
    expect(row.kind).toBe(kind)
    expect(row.label).toBe(label)
    expect('canDownload' in row && row.canDownload).toBe(canDownload)
    expect(usesCloud(status)).toBe(cloud)
  })
})

describe('createBuddyService', () => {
  it('retries after a failed start and stays resting until it succeeds', async () => {
    const backend: BuddyBackend = {
      mode: 'prefer_on_device',
      onDeviceStatus: async () => 'available',
      createTurnModel: () => ({ generateContent: vi.fn() }),
    }
    const load = vi.fn<() => Promise<BuddyBackend>>().mockRejectedValueOnce(new Error('app check')).mockResolvedValue(backend)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = createBuddyService(load)

    await expect(service.model()).rejects.toThrow('app check')
    expect(service.status()).toEqual({ phase: 'resting' })

    await expect(service.model()).resolves.toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
    expect(service.status()).toEqual(ready('prefer_on_device', 'available'))
    warn.mockRestore()
  })
})
