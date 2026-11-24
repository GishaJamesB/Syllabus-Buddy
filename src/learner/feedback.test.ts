import { describe, expect, it } from 'vitest'
import { grade } from '../maths/grade'
import { generate } from '../maths/registry'
import type { Question, Unit } from '../maths/types'
import { feedbackFor } from './feedback'

const perim = generate('perim_rectangle', 'easy', 1)
const area = generate('area_rectangle', 'easy', 1)
const fence = generate('perim_fencing_cost', 'easy', 1)
const lengthUnit = perim.answer.unit
const areaUnit = area.answer.unit

const say = (q: Question, text: string, unit: Unit | null) => feedbackFor(grade(q, { text, unit }), q)

describe('feedbackFor', () => {
  it('praises a correct answer', () => {
    expect(say(perim, String(perim.answer.value), lengthUnit).tone).toBe('correct')
  })
  it('asks for a whole number for text, decimals and empty input', () => {
    for (const t of ['abc', '4.5', '']) expect(say(perim, t, lengthUnit)).toMatchObject({ tone: 'retry', message: 'Type a whole number' })
  })
  it('handles a wrong number with a hint for a known mistake', () => {
    const twoSides = perim.mistakes.find((m) => m.code === 'perim_two_sides_only')!
    expect(say(perim, String(twoSides.value), lengthUnit)).toEqual({
      tone: 'miss',
      message: 'Not quite. Look at the example again',
      hint: 'Did you add all the sides?',
    })
    expect(say(perim, '99999', lengthUnit).hint).toBeNull()
  })
  it('reminds about missing units', () => {
    expect(say(perim, String(perim.answer.value), null).message).toBe("Don't forget the units")
  })
  it('explains the wrong power for area and length', () => {
    expect(say(area, String(area.answer.value), areaUnit === 'sq cm' ? 'cm' : 'm').message).toBe('Area uses square units like sq cm')
    expect(say(perim, String(perim.answer.value), lengthUnit === 'cm' ? 'sq cm' : 'sq m').message).toBe(
      'Perimeter is a length, so use cm or m',
    )
  })
  it('flags a unit mismatch', () => {
    expect(say(perim, String(perim.answer.value), lengthUnit === 'cm' ? 'm' : 'cm').message).toBe('Right number, check the unit')
  })
  it('accepts a dollar answer as S$480, $480 or 480', () => {
    for (const text of [`S$${fence.answer.value}`, `$${fence.answer.value}`, String(fence.answer.value)]) {
      expect(say(fence, text, 'S$').tone).toBe('correct')
    }
  })
})
