import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import type { InferenceModeValue } from '../firebase/config'
import { missTurn, type BuddyReply, type MissTurn, type TurnModel } from './buddy'
import { getOnDeviceStatus, type OnDeviceStatus } from './onDeviceStatus'
import type { FunctionDeclaration } from 'firebase/ai'
import type { TutorModel } from './tutorAgent'
import { DEFAULT_TUNING, type TuningValues } from '../config/tuning'
import { readConfig, type AppConfig } from '../firebase/config'
import type { FirebaseServices } from '../firebase/init'
import { sharedFirebase } from '../firebase/shared'

export type DeviceTurnModel = TurnModel & {
  initializeDeviceModel?(onProgress?: (progress: number) => void): Promise<void>
}

export interface BuddyBackend {
  mode: InferenceModeValue
  createTurnModel(): DeviceTurnModel
  createTutorModel?(tools: FunctionDeclaration[]): TutorModel
  createSummaryModel?(): TurnModel
  onDeviceStatus(): Promise<OnDeviceStatus>
  warmUp?(): Promise<void>
  tuning?: TuningValues
}

export type BrainStatus =
  | { phase: 'starting' }
  | { phase: 'resting' }
  | { phase: 'ready'; mode: InferenceModeValue; nano: OnDeviceStatus; download: number | null }

export interface BuddyService {
  start(): void
  status(): BrainStatus
  subscribe(listener: () => void): () => void
  model(): Promise<TurnModel>
  tutorModel(tools: FunctionDeclaration[]): Promise<TutorModel>
  summaryModel(): Promise<TurnModel>
  tuning(): TuningValues
  downloadDeviceModel(): Promise<void>
}

export function createBuddyService(load: () => Promise<BuddyBackend>): BuddyService {
  let current: BrainStatus = { phase: 'starting' }
  let backend: Promise<BuddyBackend> | null = null
  let tuning: TuningValues = DEFAULT_TUNING
  const listeners = new Set<() => void>()

  const set = (next: BrainStatus) => {
    current = next
    listeners.forEach((l) => l())
  }

  function warmUp(b: BuddyBackend, nano: OnDeviceStatus) {
    if (nano !== 'available' || CLOUD_MODES.includes(b.mode) || !b.warmUp) return
    b.warmUp().catch(() => {})
  }

  function start(): Promise<BuddyBackend> {
    if (!backend) {
      const attempt = (async () => {
        const b = await load()
        const nano = await b.onDeviceStatus().catch((): OnDeviceStatus => 'unavailable')
        tuning = b.tuning ?? { ...DEFAULT_TUNING, inference_mode: b.mode }
        set({ phase: 'ready', mode: b.mode, nano, download: null })
        warmUp(b, nano)
        return b
      })()
      backend = attempt
      attempt.catch((e: unknown) => {
        console.warn('Buddy could not start', e)
        if (backend === attempt) backend = null
        set({ phase: 'resting' })
      })
    }
    return backend
  }

  return {
    start() {
      void start().catch(() => {})
    },
    status: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async model() {
      return (await start()).createTurnModel()
    },
    async tutorModel(tools) {
      const b = await start()
      if (!b.createTutorModel) throw new Error('The tutor model is not available')
      return b.createTutorModel(tools)
    },
    async summaryModel() {
      const b = await start()
      if (current.phase !== 'ready' || current.nano !== 'available' || CLOUD_MODES.includes(b.mode) || !b.createSummaryModel) {
        throw new Error('The on-device summary model is not available')
      }
      return b.createSummaryModel()
    },
    tuning: () => tuning,
    async downloadDeviceModel() {
      const b = await start()
      const model = b.createTurnModel()
      if (!model.initializeDeviceModel || current.phase !== 'ready') return
      const ready = current
      set({ ...ready, nano: 'downloading', download: 0 })
      const onProgress = (fraction: number) => {
        if (current.phase === 'ready') set({ ...current, download: fraction })
      }
      try {
        await model.initializeDeviceModel(onProgress)
      } catch (e) {
        console.warn('On-device Buddy download failed', e)
      }
      const nano = await b.onDeviceStatus().catch((): OnDeviceStatus => 'unavailable')
      set({ ...ready, nano, download: null })
      warmUp(b, nano)
    },
  }
}

async function loadFirebaseBackend(): Promise<BuddyBackend> {
  const result = readConfig(import.meta.env as Record<string, string | undefined>)
  if (!result.ok) throw new Error(`Missing environment variables: ${result.missing.join(', ')}`)
  return backendFrom(await sharedFirebase(), result.config)
}

export function backendFrom(
  services: Pick<FirebaseServices, 'tuning' | 'createTurnModel' | 'createTutorModel' | 'createSummaryModel'>,
  config: Pick<AppConfig, 'tutorModel'>,
): BuddyBackend {
  let turnModel: DeviceTurnModel | null = null
  const sharedTurnModel = () => (turnModel ??= services.createTurnModel())
  return {
    mode: services.tuning.values.inference_mode,
    tuning: services.tuning.values,
    createTurnModel: sharedTurnModel,
    createTutorModel: (tools) => services.createTutorModel(config.tutorModel, tools),
    createSummaryModel: () => services.createSummaryModel(),
    onDeviceStatus: getOnDeviceStatus,
    warmUp: async () => {
      await sharedTurnModel().generateContent(WARM_UP_PROMPT)
    },
  }
}

// The Firebase SDK keeps Nano loaded only while one model object holds its last on-device session,
// so every Buddy turn reuses the same model. A new prompt replaces any prompt still running, which
// is what we want because only the reply to the child's latest answer is shown.
const WARM_UP_PROMPT = 'Reply with this JSON only: {"intent": "off_topic", "misconception": null, "clue": null}'

let shared: BuddyService | null = null

export function firebaseBuddy(): BuddyService {
  shared ??= createBuddyService(loadFirebaseBackend)
  return shared
}

export function useBrainStatus(service: BuddyService): BrainStatus {
  return useSyncExternalStore(service.subscribe, service.status)
}

const CLOUD_MODES: InferenceModeValue[] = ['only_in_cloud', 'prefer_in_cloud']

export type BrainRow =
  | { kind: 'starting'; label: string }
  | { kind: 'resting'; label: string }
  | { kind: 'cloud'; label: string; canDownload: boolean }
  | { kind: 'device'; label: string }
  | { kind: 'downloading'; label: string }
  | { kind: 'needs_device'; label: string; canDownload: boolean }

export function brainRow(status: BrainStatus): BrainRow {
  if (status.phase === 'starting') return { kind: 'starting', label: 'Waking Buddy up…' }
  if (status.phase === 'resting') return { kind: 'resting', label: 'Buddy is resting' }
  const cloud: BrainRow = { kind: 'cloud', label: '☁️ Using the cloud', canDownload: false }
  const needsDevice: BrainRow = { kind: 'needs_device', label: 'Needs on-device Buddy', canDownload: false }
  const deviceOnly = status.mode === 'only_on_device'
  if (CLOUD_MODES.includes(status.mode)) return cloud
  switch (status.nano) {
    case 'available':
      return { kind: 'device', label: '🔒 Ready on this device' }
    case 'downloading':
      return {
        kind: 'downloading',
        label: status.download === null ? 'Downloading…' : `Downloading ${Math.round(status.download * 100)}%`,
      }
    case 'downloadable':
      return { ...(deviceOnly ? needsDevice : cloud), canDownload: true }
    default:
      return deviceOnly ? needsDevice : cloud
  }
}

export function usesCloud(status: BrainStatus): boolean {
  const kind = brainRow(status).kind
  if (kind === 'cloud') return true
  return kind === 'downloading' && status.phase === 'ready' && status.mode !== 'only_on_device'
}

export interface TurnContext {
  profileId: string
  ideaId: string
  seed: number
}

export type BuddyRequest = { kind: 'miss'; turn: MissTurn }

export interface BuddyView {
  context: TurnContext
  kind: BuddyRequest['kind']
  reply: BuddyReply | null
}

interface Options {
  service: BuddyService
  currentContext: () => TurnContext | null
  onShown: (context: TurnContext, request: BuddyRequest, reply: BuddyReply) => void
}

export function useBuddyTurns(options: Options) {
  const [view, setView] = useState<BuddyView | null>(null)
  const counter = useRef(0)
  const opts = useRef(options)
  opts.current = options

  const send = useCallback(async (context: TurnContext, request: BuddyRequest) => {
    const n = ++counter.current
    setView({ context, kind: request.kind, reply: null })
    let reply: BuddyReply
    try {
      const model = await opts.current.service.model()
      reply = await missTurn(model, request.turn)
    } catch {
      reply = { outcome: 'failed' }
    }
    const now = opts.current.currentContext()
    const moved =
      !now || now.profileId !== context.profileId || now.ideaId !== context.ideaId || now.seed !== context.seed
    if (counter.current !== n || moved) return
    setView({ context, kind: request.kind, reply })
    opts.current.onShown(context, request, reply)
  }, [])

  const clear = useCallback(() => {
    counter.current++
    setView(null)
  }, [])

  return { view, send, clear }
}
