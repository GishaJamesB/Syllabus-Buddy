import type { GradeResult, Question, Unit } from './types'

const AREA_UNITS: Unit[] = ['sq cm', 'sq m']
const LENGTH_UNITS: Unit[] = ['cm', 'm']

function unitKind(unit: Unit): 'area' | 'length' | 'money' {
  if (AREA_UNITS.includes(unit)) return 'area'
  if (LENGTH_UNITS.includes(unit)) return 'length'
  return 'money'
}

export function grade(question: Question, input: { text: string; unit?: Unit | null }): GradeResult {
  let text = input.text.replace(/[,\s]/g, '')
  if (question.answer.unit === 'S$') text = text.replace(/^(sgd|s\$|\$)/i, '')
  if (!/^\d+$/.test(text)) return { correct: false, code: null, reason: 'not_a_number' }
  const value = Number(text)

  if (value !== question.answer.value) {
    const known = question.mistakes.find((m) => m.value === value)
    return { correct: false, code: known?.code ?? null, reason: 'wrong_number' }
  }

  if (!input.unit) return { correct: false, code: 'units_missing', reason: 'units_missing' }
  if (input.unit === question.answer.unit) return { correct: true, code: null }
  const given = unitKind(input.unit)
  const expected = unitKind(question.answer.unit)
  if (given !== expected && given !== 'money' && expected !== 'money') {
    return { correct: false, code: 'units_wrong_power', reason: 'units_wrong_power' }
  }
  return { correct: false, code: null, reason: 'unit_mismatch' }
}
