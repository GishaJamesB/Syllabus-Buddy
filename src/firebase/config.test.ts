import { describe, expect, it } from 'vitest'
import { DEFAULT_CLOUD_MODEL, DEFAULT_TUTOR_MODEL, readConfig, REQUIRED_KEYS } from './config'

const full = Object.fromEntries(REQUIRED_KEYS.map((k) => [k, 'x']))

describe('readConfig', () => {
  it('lists every missing key for an empty env', () => {
    const r = readConfig({})
    expect(r).toEqual({ ok: false, missing: [...REQUIRED_KEYS] })
  })

  it('lists only the missing keys, treating blanks as missing', () => {
    const r = readConfig({ ...full, VITE_FIREBASE_APP_ID: '  ', VITE_RECAPTCHA_SITE_KEY: undefined })
    expect(r).toEqual({ ok: false, missing: ['VITE_FIREBASE_APP_ID', 'VITE_RECAPTCHA_SITE_KEY'] })
  })

  it('defaults the inference mode', () => {
    const r = readConfig(full)
    expect(r.ok && r.config.inferenceMode).toBe('prefer_on_device')
  })

  it('defaults cloudModel when missing or blank', () => {
    const a = readConfig(full)
    const b = readConfig({ ...full, VITE_CLOUD_MODEL: '  ' })
    expect(a.ok && a.config.cloudModel).toBe(DEFAULT_CLOUD_MODEL)
    expect(b.ok && b.config.cloudModel).toBe(DEFAULT_CLOUD_MODEL)
  })

  it('defaults tutorModel when missing or blank, and reads VITE_TUTOR_MODEL', () => {
    const a = readConfig({ ...full, VITE_TUTOR_MODEL: ' ' })
    const b = readConfig({ ...full, VITE_TUTOR_MODEL: 'my-model' })
    expect(a.ok && a.config.tutorModel).toBe(DEFAULT_TUTOR_MODEL)
    expect(b.ok && b.config.tutorModel).toBe('my-model')
  })

  it('trims values', () => {
    const r = readConfig({ ...full, VITE_FIREBASE_API_KEY: '  key  ' })
    expect(r.ok && r.config.firebase.apiKey).toBe('key')
  })

  it('accepts a valid mode and ignores an invalid one', () => {
    const a = readConfig({ ...full, VITE_INFERENCE_MODE: 'only_in_cloud' })
    const b = readConfig({ ...full, VITE_INFERENCE_MODE: 'nonsense' })
    expect(a.ok && a.config.inferenceMode).toBe('only_in_cloud')
    expect(b.ok && b.config.inferenceMode).toBe('prefer_on_device')
  })
})
