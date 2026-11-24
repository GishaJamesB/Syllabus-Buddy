import { createContext, useContext } from 'react'
import type { LessonDifficulty } from '../content/lessonSchema'
import { INFERENCE_MODES, type InferenceModeValue } from '../firebase/config'

export const TUNING_KEYS = [
  'max_turns',
  'misses_before_help',
  'test_seconds_easy',
  'test_seconds_medium',
  'test_seconds_hard',
  'inference_mode',
] as const

export type TuningKey = (typeof TUNING_KEYS)[number]
type NumberKey = Exclude<TuningKey, 'inference_mode'>

export type TuningValues = Record<NumberKey, number> & { inference_mode: InferenceModeValue }

export type TuningSource = 'default' | 'remote'

export interface TuningState {
  values: TuningValues
  sources: Record<TuningKey, TuningSource>
  raw: Partial<Record<TuningKey, string>>
}

export const TUNING_RANGES: Record<NumberKey, { min: number; max: number }> = {
  max_turns: { min: 2, max: 10 },
  misses_before_help: { min: 1, max: 6 },
  test_seconds_easy: { min: 30, max: 600 },
  test_seconds_medium: { min: 30, max: 600 },
  test_seconds_hard: { min: 30, max: 600 },
}

export function defaultTuning(inferenceMode: InferenceModeValue = 'prefer_on_device'): TuningValues {
  return {
    max_turns: 5,
    misses_before_help: 3,
    test_seconds_easy: 90,
    test_seconds_medium: 120,
    test_seconds_hard: 150,
    inference_mode: inferenceMode,
  }
}

export const DEFAULT_TUNING: TuningValues = defaultTuning()

function parseNumber(key: NumberKey, raw: string): number | null {
  const text = raw.trim()
  if (!/^-?\d+$/.test(text)) return null
  const n = Number(text)
  const { min, max } = TUNING_RANGES[key]
  return n >= min && n <= max ? n : null
}

function parseMode(raw: string): InferenceModeValue | null {
  const mode = raw.trim().toLowerCase()
  return (INFERENCE_MODES as readonly string[]).includes(mode) ? (mode as InferenceModeValue) : null
}

export function parseTuning(
  raw: Partial<Record<TuningKey, string>>,
  defaults: TuningValues,
): { values: TuningValues; rejected: Partial<Record<TuningKey, string>> } {
  const values = { ...defaults }
  const rejected: Partial<Record<TuningKey, string>> = {}
  for (const key of TUNING_KEYS) {
    const text = raw[key]
    if (text === undefined) continue
    if (key === 'inference_mode') {
      const mode = parseMode(text)
      if (mode) values.inference_mode = mode
      else if (text.trim() !== '') rejected[key] = text
    } else {
      const n = parseNumber(key, text)
      if (n !== null) values[key] = n
      else if (text.trim() !== '') rejected[key] = text
    }
  }
  return { values, rejected }
}

export function allDefaults(values: TuningValues): TuningState {
  const sources = Object.fromEntries(TUNING_KEYS.map((k) => [k, 'default'])) as Record<TuningKey, TuningSource>
  return { values, sources, raw: {} }
}

export function tuningState(
  raw: Partial<Record<TuningKey, string>>,
  remoteKeys: ReadonlySet<TuningKey>,
  defaults: TuningValues,
): TuningState {
  const { values, rejected } = parseTuning(raw, defaults)
  const sources = Object.fromEntries(
    TUNING_KEYS.map((k) => [k, remoteKeys.has(k) && !(k in rejected) ? 'remote' : 'default']),
  ) as Record<TuningKey, TuningSource>
  return { values, sources, raw: rejected }
}

export function remoteDefaults(values: TuningValues): Record<string, string | number> {
  return { ...values }
}

export function testSeconds(values: TuningValues): Record<LessonDifficulty, number> {
  return { easy: values.test_seconds_easy, medium: values.test_seconds_medium, hard: values.test_seconds_hard }
}

export const TuningContext = createContext<TuningValues>(DEFAULT_TUNING)

export function useTuning(): TuningValues {
  return useContext(TuningContext)
}
