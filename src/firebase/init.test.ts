import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
const rc = { defaultConfig: {} as Record<string, unknown>, settings: {} as Record<string, unknown> }
let remote: Record<string, string> = {}
let supported = true
let failAt: string | null = null
let hang: string | null = null

function step(name: string) {
  calls.push(name)
  if (failAt === name) throw new Error(`${name} failed`)
}

vi.mock('firebase/remote-config', () => ({
  isSupported: async () => {
    step('isSupported')
    return supported
  },
  getRemoteConfig: () => {
    step('getRemoteConfig')
    return rc
  },
  ensureInitialized: () => (hang === 'ensureInitialized' ? new Promise(() => {}) : Promise.resolve(step('ensureInitialized'))),
  activate: async () => {
    step('activate')
    return true
  },
  fetchConfig: () => {
    calls.push('fetchConfig')
    return failAt === 'fetchConfig' ? Promise.reject(new Error('offline')) : new Promise(() => {})
  },
  getValue: (_: unknown, key: string) => ({
    asString: () => (key in remote ? remote[key] : String(rc.defaultConfig[key] ?? '')),
    getSource: () => (key in remote ? 'remote' : 'default'),
  }),
}))

const models: { params: Record<string, unknown> }[] = []

vi.mock('firebase/app', () => ({ initializeApp: () => ({ name: 'app' }) }))
vi.mock('firebase/app-check', () => ({
  initializeAppCheck: () => ({}),
  getToken: async () => {
    calls.push('getToken')
    return { token: 't' }
  },
  ReCaptchaV3Provider: class {},
}))
vi.mock('firebase/auth', () => ({
  getAuth: () => ({}),
  signInAnonymously: async () => {
    calls.push('signIn')
    return { user: { uid: 'u1' } }
  },
}))
vi.mock('firebase/firestore', () => ({
  initializeFirestore: () => ({ name: 'firestore' }),
  persistentLocalCache: () => ({}),
  persistentMultipleTabManager: () => ({}),
  memoryLocalCache: () => ({}),
}))
vi.mock('firebase/ai', () => ({
  FunctionCallingMode: { AUTO: 'AUTO' },
  getAI: () => ({}),
  getGenerativeModel: (_: unknown, params: Record<string, unknown>) => {
    models.push({ params })
    return { params }
  },
  GoogleAIBackend: class {},
  InferenceMode: {
    PREFER_ON_DEVICE: 'prefer_on_device',
    ONLY_ON_DEVICE: 'only_on_device',
    ONLY_IN_CLOUD: 'only_in_cloud',
    PREFER_IN_CLOUD: 'prefer_in_cloud',
  },
  ThinkingLevel: { LOW: 'LOW' },
}))

const { initFirebase, loadTuning, TUNING_TIMEOUT_MS } = await import('./init')
const { defaultTuning, DEFAULT_TUNING } = await import('../config/tuning')
const { backendFrom, createBuddyService, brainRow } = await import('../ai/useBuddy')

const config = {
  firebase: { apiKey: 'k', authDomain: 'd', projectId: 'p', storageBucket: 'b', messagingSenderId: 'm', appId: 'a' },
  recaptchaKey: 'r',
  inferenceMode: 'prefer_on_device' as const,
  cloudModel: 'cloud',
  tutorModel: 'tutor',
}

beforeEach(() => {
  calls.length = 0
  models.length = 0
  remote = {}
  supported = true
  failAt = null
  hang = null
  rc.defaultConfig = {}
  rc.settings = {}
})

describe('loadTuning', () => {
  it('sets defaults and settings, activates the cached values, then fetches without waiting', async () => {
    remote = { max_turns: '7', misses_before_help: 'abc' }
    const state = await loadTuning({} as never, DEFAULT_TUNING)
    expect(calls).toEqual(['isSupported', 'getRemoteConfig', 'ensureInitialized', 'activate', 'fetchConfig'])
    expect(rc.defaultConfig).toEqual({ ...DEFAULT_TUNING })
    expect(rc.settings).toEqual({ minimumFetchIntervalMillis: 0, fetchTimeoutMillis: 5000 })
    expect(state.values).toEqual({ ...DEFAULT_TUNING, max_turns: 7 })
    expect(state.sources.max_turns).toBe('remote')
    expect(state.sources.misses_before_help).toBe('default')
    expect(state.raw).toEqual({ misses_before_help: 'abc' })
  })

  it.each(['isSupported', 'getRemoteConfig', 'ensureInitialized', 'activate'])('returns the defaults when %s fails', async (name) => {
    failAt = name
    const state = await loadTuning({} as never, DEFAULT_TUNING)
    expect(state.values).toEqual(DEFAULT_TUNING)
    expect(Object.values(state.sources).every((s) => s === 'default')).toBe(true)
  })

  it('returns the defaults when Remote Config hangs for 3 seconds', async () => {
    vi.useFakeTimers()
    hang = 'ensureInitialized'
    const pending = loadTuning({} as never, DEFAULT_TUNING)
    await vi.advanceTimersByTimeAsync(TUNING_TIMEOUT_MS)
    expect((await pending).values).toEqual(DEFAULT_TUNING)
    expect(TUNING_TIMEOUT_MS).toBe(3000)
    vi.useRealTimers()
  })

  it('ignores a failed background fetch', async () => {
    failAt = 'fetchConfig'
    await expect(loadTuning({} as never, DEFAULT_TUNING)).resolves.toMatchObject({ values: DEFAULT_TUNING })
  })

  it('returns the defaults when Remote Config is not supported', async () => {
    supported = false
    expect((await loadTuning({} as never, defaultTuning('only_on_device'))).values.inference_mode).toBe('only_on_device')
    expect(calls).toEqual(['isSupported'])
  })
})

describe('initFirebase', () => {
  beforeEach(() => {
    vi.stubGlobal('self', {})
    return () => vi.unstubAllGlobals()
  })

  it('loads tuning after sign-in and builds the turn model with the remote cloud mode', async () => {
    remote = { inference_mode: 'only_in_cloud' }
    const services = await initFirebase(config)
    expect(calls.slice(0, 3)).toEqual(['getToken', 'signIn', 'isSupported'])
    expect(services.tuning.values.inference_mode).toBe('only_in_cloud')
    services.createTurnModel()
    expect(models[0].params.mode).toBe('only_in_cloud')

    const service = createBuddyService(async () => ({ ...backendFrom(services, config), onDeviceStatus: async () => 'available' }))
    service.start()
    await vi.waitFor(() => expect(service.status().phase).toBe('ready'))
    expect(brainRow(service.status()).kind).toBe('cloud')
    expect(service.tuning().inference_mode).toBe('only_in_cloud')
  })

  it('returns the Firestore instance', async () => {
    expect((await initFirebase(config)).firestore).toEqual({ name: 'firestore' })
  })

  it('builds the summary model on-device only with no prompt options', async () => {
    const services = await initFirebase(config)
    services.createSummaryModel()
    const params = models[0].params as { mode: string; onDeviceParams: Record<string, unknown>; inCloudParams?: unknown }
    expect(params.mode).toBe('only_on_device')
    expect(params.inCloudParams).toBeUndefined()
    expect(params.onDeviceParams).toEqual({
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      },
    })
  })
})
