export const REQUIRED_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_RECAPTCHA_ENTERPRISE_KEY',
] as const

export const INFERENCE_MODES = [
  'prefer_on_device',
  'only_on_device',
  'only_in_cloud',
  'prefer_in_cloud',
] as const

export const DEFAULT_CLOUD_MODEL = 'gemini-3.5-flash-lite'

export type InferenceModeValue = (typeof INFERENCE_MODES)[number]

export interface AppConfig {
  firebase: {
    apiKey: string
    authDomain: string
    projectId: string
    storageBucket: string
    messagingSenderId: string
    appId: string
  }
  recaptchaKey: string
  inferenceMode: InferenceModeValue
  cloudModel: string
}

export type ConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; missing: string[] }

export function readConfig(env: Record<string, string | undefined>): ConfigResult {
  const missing = REQUIRED_KEYS.filter((k) => !env[k]?.trim())
  if (missing.length > 0) return { ok: false, missing: [...missing] }

  const mode = env.VITE_INFERENCE_MODE?.trim()
  const inferenceMode = (INFERENCE_MODES as readonly string[]).includes(mode ?? '')
    ? (mode as InferenceModeValue)
    : 'prefer_on_device'

  return {
    ok: true,
    config: {
      firebase: {
        apiKey: env.VITE_FIREBASE_API_KEY!.trim(),
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN!.trim(),
        projectId: env.VITE_FIREBASE_PROJECT_ID!.trim(),
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET!.trim(),
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID!.trim(),
        appId: env.VITE_FIREBASE_APP_ID!.trim(),
      },
      recaptchaKey: env.VITE_RECAPTCHA_ENTERPRISE_KEY!.trim(),
      inferenceMode,
      cloudModel: env.VITE_CLOUD_MODEL?.trim() || DEFAULT_CLOUD_MODEL,
    },
  }
}
