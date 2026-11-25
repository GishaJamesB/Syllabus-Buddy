import { describe, expect, it, vi } from 'vitest'
import { FIREBASE_OPEN_TIMEOUT_MS, openLearnerStore } from './defaultOpen'
import { memoryStore } from './store'

vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
}))

const fallback = async () => memoryStore()

describe('openLearnerStore', () => {
  it('uses Firestore when Firebase is ready', async () => {
    const store = await openLearnerStore(async () => ({ firestore: {} as never, uid: 'u1' }), fallback)
    expect(store.persistent).toBe(true)
  })

  it('falls back when Firebase init rejects', async () => {
    const store = await openLearnerStore(() => Promise.reject(new Error('Missing environment variables')), fallback)
    expect(store.persistent).toBe(false)
  })

  it('falls back when Firebase init takes longer than the timeout', async () => {
    vi.useFakeTimers()
    const pending = openLearnerStore(() => new Promise(() => {}), fallback)
    await vi.advanceTimersByTimeAsync(FIREBASE_OPEN_TIMEOUT_MS)
    expect((await pending).persistent).toBe(false)
    vi.useRealTimers()
  })
})
