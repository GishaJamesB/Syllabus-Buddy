import { readConfig } from './config'
import type { FirebaseServices } from './init'

let shared: Promise<FirebaseServices> | null = null

export function sharedFirebase(): Promise<FirebaseServices> {
  if (!shared) {
    const attempt = (async () => {
      const result = readConfig(import.meta.env as Record<string, string | undefined>)
      if (!result.ok) throw new Error(`Missing environment variables: ${result.missing.join(', ')}`)
      const { initFirebase } = await import('./init')
      const { describeError } = await import('./describeError')
      try {
        return await initFirebase(result.config)
      } catch (e) {
        throw new Error(describeError(e))
      }
    })()
    shared = attempt
    attempt.catch(() => {
      if (shared === attempt) shared = null
    })
  }
  return shared
}
