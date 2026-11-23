import type { Rng } from '../rng'
import type { Difficulty, Unit } from '../types'

const RANGES: Record<Difficulty, { min: number; max: number; length: Unit; area: Unit }> = {
  easy: { min: 2, max: 8, length: 'cm', area: 'sq cm' },
  medium: { min: 6, max: 15, length: 'cm', area: 'sq cm' },
  hard: { min: 20, max: 250, length: 'm', area: 'sq m' },
}

export const range = (d: Difficulty) => RANGES[d]

export const side = (rng: Rng, d: Difficulty) => rng.int(RANGES[d].min, RANGES[d].max)

export function distinctPair(rng: Rng, d: Difficulty): [number, number] {
  for (;;) {
    const a = side(rng, d)
    const b = side(rng, d)
    if (a !== b) return [a, b]
  }
}

export const len = (value: number, d: Difficulty) => `${value} ${RANGES[d].length}`
