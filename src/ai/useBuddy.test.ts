import { describe, expect, it, vi } from 'vitest'
import type { InferenceModeValue } from '../firebase/config'
import type { OnDeviceStatus } from './onDeviceStatus'
import { DEFAULT_TUNING } from '../config/tuning'
import { brainRow, createBuddyService, oneAtATime, usesCloud, type BrainStatus, type BuddyBackend } from './useBuddy'

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

describe('summaryModel', () => {
  const backendWith = (mode: InferenceModeValue, nano: OnDeviceStatus) => {
    const createSummaryModel = vi.fn(() => ({ generateContent: vi.fn() }))
    const backend: BuddyBackend = {
      mode,
      onDeviceStatus: async () => nano,
      createTurnModel: () => ({ generateContent: vi.fn() }),
      createSummaryModel,
    }
    return { service: createBuddyService(async () => backend), createSummaryModel }
  }

  it.each([
    ['only_in_cloud', 'available'],
    ['prefer_in_cloud', 'available'],
    ['prefer_on_device', 'downloadable'],
    ['only_on_device', 'downloadable'],
    ['prefer_on_device', 'unavailable'],
  ] as [InferenceModeValue, OnDeviceStatus][])('never builds the summary model in %s with %s', async (mode, nano) => {
    const { service, createSummaryModel } = backendWith(mode, nano)
    await expect(service.summaryModel()).rejects.toThrow()
    expect(createSummaryModel).not.toHaveBeenCalled()
  })

  it.each(['prefer_on_device', 'only_on_device'] as InferenceModeValue[])('builds it when Nano is available in %s', async (mode) => {
    const { service, createSummaryModel } = backendWith(mode, 'available')
    await expect(service.summaryModel()).resolves.toBeTruthy()
    expect(createSummaryModel).toHaveBeenCalledTimes(1)
  })
})

describe('warm-up', () => {
  it.each([
    ['prefer_on_device', 'available', 1],
    ['only_on_device', 'available', 1],
    ['only_in_cloud', 'available', 0],
    ['prefer_in_cloud', 'available', 0],
    ['prefer_on_device', 'downloadable', 0],
    ['prefer_on_device', 'unavailable', 0],
  ] as [InferenceModeValue, OnDeviceStatus, number][])('in %s with %s warms up %i time(s)', async (mode, nano, times) => {
    const warmUp = vi.fn(async () => {})
    const service = createBuddyService(async () => ({
      mode,
      onDeviceStatus: async () => nano,
      createTurnModel: () => ({ generateContent: vi.fn() }),
      warmUp,
    }))
    await service.model()
    expect(warmUp).toHaveBeenCalledTimes(times)
  })

  it('ignores a failed warm-up', async () => {
    const service = createBuddyService(async () => ({
      mode: 'prefer_on_device',
      onDeviceStatus: async () => 'available',
      createTurnModel: () => ({ generateContent: vi.fn() }),
      warmUp: () => Promise.reject(new Error('busy')),
    }))
    await expect(service.model()).resolves.toBeTruthy()
    expect(service.status()).toEqual(ready('prefer_on_device', 'available'))
  })
})

describe('oneAtATime', () => {
  it('starts the next prompt only after the previous one settles, even if it failed', async () => {
    const order: string[] = []
    let failFirst!: (e: Error) => void
    const generateContent = vi.fn((prompt: string) => {
      order.push(`start ${prompt}`)
      if (prompt === 'a') return new Promise<never>((_, reject) => (failFirst = reject))
      return Promise.resolve({ response: { text: () => prompt } })
    })
    const model = oneAtATime({ generateContent })

    const a = model.generateContent('a')
    const b = model.generateContent('b')
    await Promise.resolve()
    expect(order).toEqual(['start a'])

    failFirst(new Error('boom'))
    await expect(a).rejects.toThrow('boom')
    await expect(b).resolves.toMatchObject({ response: {} })
    expect(order).toEqual(['start a', 'start b'])
  })
})

describe('tuning', () => {
  it('uses the defaults until the backend is ready, then the backend tuning', async () => {
    const tuning = { ...DEFAULT_TUNING, misses_before_help: 2 }
    const service = createBuddyService(async () => ({
      mode: 'prefer_on_device',
      tuning,
      onDeviceStatus: async () => 'available',
      createTurnModel: () => ({ generateContent: vi.fn() }),
    }))
    expect(service.tuning()).toBe(DEFAULT_TUNING)
    await service.model()
    expect(service.tuning()).toBe(tuning)
  })
})
