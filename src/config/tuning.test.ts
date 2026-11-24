import { describe, expect, it } from 'vitest'
import { DEFAULT_TUNING, defaultTuning, parseTuning, testSeconds, TUNING_RANGES, tuningState } from './tuning'

describe('parseTuning', () => {
  it('uses the defaults for an empty input', () => {
    expect(parseTuning({}, DEFAULT_TUNING)).toEqual({ values: DEFAULT_TUNING, rejected: {} })
  })

  it('accepts integers at the edges of each range and rejects values just outside', () => {
    for (const [key, { min, max }] of Object.entries(TUNING_RANGES)) {
      const k = key as keyof typeof TUNING_RANGES
      expect(parseTuning({ [k]: String(min) }, DEFAULT_TUNING).values[k]).toBe(min)
      expect(parseTuning({ [k]: String(max) }, DEFAULT_TUNING).values[k]).toBe(max)
      expect(parseTuning({ [k]: String(min - 1) }, DEFAULT_TUNING).values[k]).toBe(DEFAULT_TUNING[k])
      expect(parseTuning({ [k]: String(max + 1) }, DEFAULT_TUNING).values[k]).toBe(DEFAULT_TUNING[k])
    }
  })

  it.each(['abc', '5.5', '', ' ', 'NaN', '1e1', '50'])('falls back to the default for max_turns=%j', (raw) => {
    expect(parseTuning({ max_turns: raw }, DEFAULT_TUNING).values.max_turns).toBe(5)
  })

  it('keeps rejected non-empty values', () => {
    expect(parseTuning({ max_turns: '50', misses_before_help: '', inference_mode: 'fast' }, DEFAULT_TUNING).rejected).toEqual({
      max_turns: '50',
      inference_mode: 'fast',
    })
  })

  it('matches the inference mode in lowercase and defaults to the env mode', () => {
    const defaults = defaultTuning('only_on_device')
    expect(parseTuning({ inference_mode: ' ONLY_IN_CLOUD ' }, defaults).values.inference_mode).toBe('only_in_cloud')
    expect(parseTuning({ inference_mode: 'cloud' }, defaults).values.inference_mode).toBe('only_on_device')
  })

  it('reads the test seconds per difficulty', () => {
    const { values } = parseTuning({ test_seconds_easy: '60', test_seconds_hard: '600' }, DEFAULT_TUNING)
    expect(testSeconds(values)).toEqual({ easy: 60, medium: 120, hard: 600 })
  })
})

describe('tuningState', () => {
  it('marks accepted remote values as remote and rejected ones as default', () => {
    const state = tuningState(
      { max_turns: '7', misses_before_help: '99', test_seconds_easy: '90' },
      new Set(['max_turns', 'misses_before_help'] as const),
      DEFAULT_TUNING,
    )
    expect(state.values.max_turns).toBe(7)
    expect(state.values.misses_before_help).toBe(3)
    expect(state.sources).toMatchObject({ max_turns: 'remote', misses_before_help: 'default', test_seconds_easy: 'default' })
    expect(state.raw).toEqual({ misses_before_help: '99' })
  })
})
