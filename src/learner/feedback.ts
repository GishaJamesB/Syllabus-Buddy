import type { GradeResult, MistakeCode, Question } from '../maths/types'

export interface Feedback {
  tone: 'correct' | 'miss' | 'retry'
  message: string
  hint: string | null
}

export const MISTAKE_HINTS: Partial<Record<MistakeCode, string>> = {
  perim_two_sides_only: 'Did you add all the sides?',
  perim_area_confused: 'Is the question asking for perimeter or area?',
  area_added_not_multiplied: 'For area, multiply the sides instead of adding them.',
  square_side_vs_perimeter: 'Did you use one side or all four?',
  rectilinear_missed_edge: 'Did you count every part of the shape?',
}

const isAreaAnswer = (question: Question) => question.answer.unit === 'sq cm' || question.answer.unit === 'sq m'

export function feedbackFor(result: GradeResult, question: Question): Feedback {
  if (result.correct) return { tone: 'correct', message: 'Yes! That is right. Well done!', hint: null }
  switch (result.reason) {
    case 'not_a_number':
      return { tone: 'retry', message: 'Type a whole number', hint: null }
    case 'units_missing':
      return { tone: 'miss', message: "Don't forget the units", hint: null }
    case 'units_wrong_power':
      return {
        tone: 'miss',
        message: isAreaAnswer(question) ? 'Area uses square units like sq cm' : 'Perimeter is a length, so use cm or m',
        hint: null,
      }
    case 'unit_mismatch':
      return { tone: 'miss', message: 'Right number, check the unit', hint: null }
    case 'wrong_number':
    default:
      return {
        tone: 'miss',
        message: 'Not quite. Look at the example again',
        hint: (result.code && MISTAKE_HINTS[result.code]) ?? null,
      }
  }
}
