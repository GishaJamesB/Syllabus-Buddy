import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOnDeviceStatus } from './onDeviceStatus'

afterEach(() => vi.unstubAllGlobals())

describe('getOnDeviceStatus', () => {
  it('is unavailable without LanguageModel', async () => {
    vi.stubGlobal('LanguageModel', undefined)
    expect(await getOnDeviceStatus()).toBe('unavailable')
  })

  it('is unavailable when availability rejects', async () => {
    vi.stubGlobal('LanguageModel', { availability: () => Promise.reject(new Error('x')) })
    expect(await getOnDeviceStatus()).toBe('unavailable')
  })

  it('passes through the reported status', async () => {
    vi.stubGlobal('LanguageModel', { availability: () => Promise.resolve('downloadable') })
    expect(await getOnDeviceStatus()).toBe('downloadable')
  })
})
