import { describe, expect, it } from 'vitest'
import { grade } from './grade'
import { generate, getTemplate, listTemplates } from './registry'
import { createRng } from './rng'
import { formatAnswer, type Difficulty, type Question } from './types'

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']
const RANGES = { easy: [2, 8], medium: [6, 15], hard: [20, 250] } as const

describe('rng', () => {
  it('is reproducible and stays in range', () => {
    const a = createRng(7)
    const b = createRng(7)
    for (let i = 0; i < 50; i++) {
      const v = a.int(3, 9)
      expect(v).toBe(b.int(3, 9))
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(9)
    }
  })
})

describe('registry', () => {
  it('lists the 13 templates', () => {
    expect(listTemplates()).toHaveLength(13)
    expect(listTemplates('perimeter')).toHaveLength(7)
    expect(listTemplates('area')).toHaveLength(6)
    expect(getTemplate('nope')).toBeUndefined()
  })

  it('gives identical questions for the same seed', () => {
    for (const t of listTemplates()) {
      expect(generate(t.id, 'medium', 42)).toEqual(generate(t.id, 'medium', 42))
    }
  })
})

function find(templateId: string, pick: (q: Question) => boolean): Question {
  for (let seed = 1; seed < 5000; seed++) {
    const q = generate(templateId, 'easy', seed)
    if (pick(q)) return q
  }
  throw new Error('no matching question')
}

describe('grader matrix', () => {
  const rect = find('perim_rectangle', (q) => q.numbers.length + q.numbers.breadth !== q.answer.value)
  const [l, b] = [rect.numbers.length, rect.numbers.breadth]
  const unit = rect.answer.unit

  it('accepts the correct answer', () => {
    expect(grade(rect, { text: String(rect.answer.value), unit })).toEqual({ correct: true, code: null })
  })
  it('detects two sides only', () => {
    expect(grade(rect, { text: String(l + b), unit }).code).toBe('perim_two_sides_only')
  })
  it('detects perimeter/area confusion', () => {
    const r = grade(rect, { text: String(l * b), unit })
    expect(r).toMatchObject({ correct: false, code: 'perim_area_confused' })
  })
  it('detects area added not multiplied', () => {
    const q = generate('area_rectangle', 'easy', 3)
    const r = grade(q, { text: String(q.numbers.length + q.numbers.breadth), unit: q.answer.unit })
    expect(r.code).toBe('area_added_not_multiplied')
  })
  it('detects area answered as 2(l+b)', () => {
    const q = generate('area_rectangle', 'easy', 3)
    expect(grade(q, { text: String(2 * (q.numbers.length + q.numbers.breadth)), unit: q.answer.unit }).code).toBe(
      'perim_area_confused',
    )
  })
  it('detects square side vs perimeter', () => {
    const q = generate('perim_square', 'easy', 5)
    expect(grade(q, { text: String(q.numbers.side), unit: q.answer.unit }).code).toBe('square_side_vs_perimeter')
  })
  it('detects a missed L-shape part', () => {
    const q = generate('area_l_shape', 'easy', 5)
    const m = q.mistakes[0]
    expect(grade(q, { text: String(m.value), unit: q.answer.unit }).code).toBe('rectilinear_missed_edge')
  })
  it('flags missing and wrong-kind units', () => {
    const q = generate('area_rectangle', 'easy', 9)
    const v = String(q.answer.value)
    expect(grade(q, { text: v })).toMatchObject({ correct: false, code: 'units_missing' })
    expect(grade(q, { text: v, unit: 'm' })).toMatchObject({ correct: false, code: 'units_wrong_power' })
    expect(grade(q, { text: v, unit: 'cm' })).toMatchObject({ correct: false, code: 'units_wrong_power' })
  })
  it('flags same-kind wrong units as unit_mismatch', () => {
    const q = generate('area_rectangle', 'easy', 9)
    expect(grade(q, { text: String(q.answer.value), unit: 'sq m' })).toMatchObject({ correct: false, code: null, reason: 'unit_mismatch' })
    const p = generate('perim_rectangle', 'easy', 9)
    expect(grade(p, { text: String(p.answer.value), unit: 'm' })).toMatchObject({ correct: false, code: null, reason: 'unit_mismatch' })
  })
  it('does not use units_wrong_power when money is involved', () => {
    const cost = generate('perim_fencing_cost', 'easy', 9)
    const v = String(cost.answer.value)
    expect(grade(cost, { text: v, unit: 'cm' })).toMatchObject({ correct: false, code: null, reason: 'unit_mismatch' })
    const area = generate('area_rectangle', 'easy', 9)
    expect(grade(area, { text: String(area.answer.value), unit: '₹' })).toMatchObject({ correct: false, code: null, reason: 'unit_mismatch' })
  })
  it('accepts commas, spaces and the rupee sign', () => {
    const cost = find('perim_fencing_cost', (q) => q.answer.value >= 1000)
    const v = String(cost.answer.value)
    const withComma = v.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    expect(grade(cost, { text: withComma, unit: '₹' }).correct).toBe(true)
    expect(grade(cost, { text: `₹${v}`, unit: '₹' }).correct).toBe(true)
    expect(grade(cost, { text: ` ${v} `, unit: '₹' }).correct).toBe(true)
  })
  it('lets a number error win over a unit error', () => {
    const q = generate('area_rectangle', 'easy', 9)
    const wrong = String(q.numbers.length + q.numbers.breadth)
    expect(grade(q, { text: wrong }).code).toBe('area_added_not_multiplied')
  })
  it('rejects unparseable input without throwing', () => {
    const q = generate('area_rectangle', 'easy', 9)
    for (const text of ['forty', '', '4o', '-3', '2.5']) {
      expect(grade(q, { text, unit: q.answer.unit })).toEqual({ correct: false, code: null, reason: 'not_a_number' })
    }
  })
})

describe('missing-side templates', () => {
  it('compute the right remaining side over 200 seeds', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const d of DIFFICULTIES) {
        const r = generate('perim_missing_side_rectangle', d, seed)
        expect(r.numbers.perimeter % 2).toBe(0)
        expect(r.answer.value).toBe(r.numbers.perimeter / 2 - r.numbers.side)
        expect(r.answer.value).toBeGreaterThanOrEqual(1)
        const s = generate('perim_missing_side_square', d, seed)
        expect(s.answer.value).toBe(s.numbers.perimeter / 4)
        const a = generate('area_missing_side_rectangle', d, seed)
        expect(a.answer.value * a.numbers.side).toBe(a.numbers.area)
      }
    }
  })
})

describe('known mistakes', () => {
  it('never equal the answer or each other over 200 seeds', () => {
    for (const t of listTemplates()) {
      for (const d of DIFFICULTIES) {
        for (let seed = 0; seed < 200; seed++) {
          const values = generate(t.id, d, seed).mistakes.map((m) => m.value)
          expect(values).not.toContain(generate(t.id, d, seed).answer.value)
          expect(new Set(values).size).toBe(values.length)
        }
      }
    }
  })
})

describe('every template x difficulty x 200 seeds', () => {
  for (const t of listTemplates()) {
    for (const d of DIFFICULTIES) {
      it(`${t.id} ${d}`, () => {
        const [min, max] = RANGES[d]
        for (let seed = 0; seed < 200; seed++) {
          const q = generate(t.id, d, seed)
          for (const n of q.dims) {
            expect(Number.isInteger(n)).toBe(true)
            expect(n).toBeGreaterThanOrEqual(min)
            expect(n).toBeLessThanOrEqual(max)
          }
          for (const n of Object.values(q.numbers)) {
            expect(Number.isInteger(n) && n > 0).toBe(true)
          }
          expect(Number.isInteger(q.answer.value) && q.answer.value > 0).toBe(true)
          expect(grade(q, { text: String(q.answer.value), unit: q.answer.unit })).toEqual({ correct: true, code: null })
          expect(q.steps.at(-1)).toContain(formatAnswer(q.answer))
        }
      })
    }
  }
})
