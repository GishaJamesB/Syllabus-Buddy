export const SETUP_GUIDE = 'docs/firebase-setup.md'

export function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const code = (e as { code?: unknown } | null)?.code
  const isAppCheck =
    (typeof code === 'string' && code.startsWith('appCheck/')) || /app-?check/i.test(msg)
  if (isAppCheck) {
    return `App Check failed: ${msg}. Check the debug token step in ${SETUP_GUIDE} (section "Register the debug token").`
  }
  return msg
}
