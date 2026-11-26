// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./firebase/init', () => ({ initFirebase: () => new Promise(() => {}) }))
vi.mock('./ai/onDeviceStatus', () => ({
  getOnDeviceStatus: () => Promise.resolve('available'),
  prepareOnDeviceModel: vi.fn(),
}))

const ENV = {
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
  VITE_FIREBASE_APP_ID: 'app',
  VITE_RECAPTCHA_SITE_KEY: 'site',
}

beforeEach(() => {
  vi.resetModules()
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

async function renderDiagnostics() {
  const mod = await import('./Diagnostics')
  render(<mod.default />)
  await screen.findByText('Prepare on-device model')
  return mod
}

describe('Diagnostics', () => {
  it('shows the Run box in dev', async () => {
    const { DiagnosticsRun } = await renderDiagnostics()
    expect(DiagnosticsRun).not.toBeNull()
    expect(await screen.findByRole('button', { name: 'Run' })).toBeTruthy()
  })

  it('keeps status and Prepare but drops the Run box in production', async () => {
    vi.stubEnv('DEV', false)
    const { DiagnosticsRun } = await renderDiagnostics()
    expect(DiagnosticsRun).toBeNull()
    expect(screen.getByText('Auth and App Check')).toBeTruthy()
    expect(screen.getByText('Tuning')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Prepare on-device model' })).toBeTruthy()
  })
})
