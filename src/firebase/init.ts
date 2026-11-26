import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getToken, initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { getAuth, signInAnonymously } from 'firebase/auth'
import {
  FunctionCallingMode,
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  ThinkingLevel,
  type FunctionDeclaration,
} from 'firebase/ai'
import { activate, ensureInitialized, fetchConfig, getRemoteConfig, getValue, isSupported } from 'firebase/remote-config'
import type { Firestore } from 'firebase/firestore'
import type { AppConfig, InferenceModeValue } from './config'
import { openFirestore } from './firestoreDb'
import { turnJsonSchema } from '../ai/turnSchema'
import { withTimeout } from '../ai/buddy'
import {
  allDefaults,
  defaultTuning,
  remoteDefaults,
  TUNING_KEYS,
  tuningState,
  type TuningKey,
  type TuningState,
  type TuningValues,
} from '../config/tuning'

const CLOUD_TIMEOUT_MS = 30_000

const MODES: Record<InferenceModeValue, InferenceMode> = {
  prefer_on_device: InferenceMode.PREFER_ON_DEVICE,
  only_on_device: InferenceMode.ONLY_ON_DEVICE,
  only_in_cloud: InferenceMode.ONLY_IN_CLOUD,
  prefer_in_cloud: InferenceMode.PREFER_IN_CLOUD,
}

export interface FirebaseServices {
  app: FirebaseApp
  uid: string
  firestore: Firestore
  tuning: TuningState
  createTurnModel: () => ReturnType<typeof getGenerativeModel>
  createAuthorModel: (model: string, timeoutMs: number, responseJsonSchema: Record<string, unknown>) => ReturnType<typeof getGenerativeModel>
  createTutorModel: (model: string, tools: FunctionDeclaration[]) => ReturnType<typeof getGenerativeModel>
  createSummaryModel: () => ReturnType<typeof getGenerativeModel>
}

export const TUNING_TIMEOUT_MS = 3000

export async function loadTuning(app: FirebaseApp, defaults: TuningValues, timeoutMs = TUNING_TIMEOUT_MS): Promise<TuningState> {
  try {
    return await withTimeout(readTuning(app, defaults), timeoutMs)
  } catch {
    return allDefaults(defaults)
  }
}

async function readTuning(app: FirebaseApp, defaults: TuningValues): Promise<TuningState> {
  if (!(await isSupported())) return allDefaults(defaults)
  const rc = getRemoteConfig(app)
  rc.defaultConfig = remoteDefaults(defaults)
  rc.settings = { minimumFetchIntervalMillis: import.meta.env.DEV ? 0 : 3_600_000, fetchTimeoutMillis: 5000 }
  await ensureInitialized(rc)
  await activate(rc)
  void fetchConfig(rc).catch(() => {})
  const raw: Partial<Record<TuningKey, string>> = {}
  const remote = new Set<TuningKey>()
  for (const key of TUNING_KEYS) {
    const value = getValue(rc, key)
    raw[key] = value.asString()
    if (value.getSource() === 'remote') remote.add(key)
  }
  return tuningState(raw, remote, defaults)
}

export async function initFirebase(config: AppConfig): Promise<FirebaseServices> {
  if (import.meta.env.DEV) {
    ;(self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true
  }
  const app = initializeApp(config.firebase)

  const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(config.recaptchaKey),
    isTokenAutoRefreshEnabled: true,
  })

  await getToken(appCheck)

  const cred = await signInAnonymously(getAuth(app))

  const firestore = openFirestore(app)

  const tuning = await loadTuning(app, defaultTuning(config.inferenceMode))

  const ai = getAI(app, { backend: new GoogleAIBackend() })
  const createTurnModel = () =>
    getGenerativeModel(
      ai,
      {
        mode: MODES[tuning.values.inference_mode],
        onDeviceParams: {
          createOptions: {
            expectedInputs: [{ type: 'text', languages: ['en'] }],
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
          },
          promptOptions: { responseConstraint: turnJsonSchema },
        },
        inCloudParams: {
          model: config.cloudModel,
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: turnJsonSchema,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        },
      },
      { timeout: CLOUD_TIMEOUT_MS },
    )

  const createAuthorModel = (model: string, timeoutMs: number, responseJsonSchema: Record<string, unknown>) =>
    getGenerativeModel(
      ai,
      {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model,
          generationConfig: { responseMimeType: 'application/json', responseJsonSchema },
        },
      },
      { timeout: timeoutMs },
    )

  const createTutorModel = (model: string, tools: FunctionDeclaration[]) =>
    getGenerativeModel(
      ai,
      {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model,
          tools: [{ functionDeclarations: tools }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
          generationConfig: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
        },
      },
      { timeout: CLOUD_TIMEOUT_MS },
    )

  const createSummaryModel = () =>
    getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: 'text', languages: ['en'] }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
        },
      },
    })

  return { app, uid: cred.user.uid, firestore, tuning, createTurnModel, createAuthorModel, createTutorModel, createSummaryModel }
}
