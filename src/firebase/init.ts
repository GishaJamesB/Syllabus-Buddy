import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, ThinkingLevel } from 'firebase/ai'
import type { AppConfig, InferenceModeValue } from './config'
import { turnJsonSchema } from '../ai/turnSchema'

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
  createTurnModel: () => ReturnType<typeof getGenerativeModel>
  createAuthorModel: (model: string, timeoutMs: number, responseJsonSchema: Record<string, unknown>) => ReturnType<typeof getGenerativeModel>
}

export async function initFirebase(config: AppConfig): Promise<FirebaseServices> {
  if (import.meta.env.DEV) {
    ;(self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true
  }
  const app = initializeApp(config.firebase)

  const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(config.recaptchaKey),
    isTokenAutoRefreshEnabled: true,
  })

  await getToken(appCheck)

  const cred = await signInAnonymously(getAuth(app))

  const ai = getAI(app, { backend: new GoogleAIBackend() })
  const createTurnModel = () =>
    getGenerativeModel(
      ai,
      {
        mode: MODES[config.inferenceMode],
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

  return { app, uid: cred.user.uid, createTurnModel, createAuthorModel }
}
