import type { MISCONCEPTIONS } from '../ai/turnSchema'

export type Difficulty = 'easy' | 'medium' | 'hard'
export type Topic = 'perimeter' | 'area'
export type Unit = 'cm' | 'm' | 'sq cm' | 'sq m' | '₹'
export type MistakeCode = (typeof MISCONCEPTIONS)[number]

export interface Answer {
  value: number
  unit: Unit
}

export type DiagramSpec =
  | { kind: 'rectangle'; width: number; height: number; labels: { width: string; height: string } }
  | { kind: 'square'; side: number; labels: { side: string } }
  | { kind: 'triangle'; a: number; b: number; c: number; labels: { a: string; b: string; c: string } }
  | { kind: 'regular_polygon'; sides: number; side: number; labels: { side: string } }
  | {
      kind: 'l_shape'
      width: number
      height: number
      notchWidth: number
      notchHeight: number
      labels: { width: string; height: string; notchWidth: string; notchHeight: string }
    }
  | {
      kind: 'rectangle_inner_square'
      width: number
      height: number
      inner: number
      labels: { width: string; height: string; inner: string }
    }
  | { kind: 'triangle_in_rectangle'; base: number; height: number; labels: { base: string; height: string } }

export interface KnownMistake {
  value: number
  code: MistakeCode
}

export interface Question {
  id: string
  templateId: string
  topic: Topic
  difficulty: Difficulty
  seed: number
  prompt: string
  dims: number[]
  numbers: Record<string, number>
  answer: Answer
  steps: string[]
  diagram: DiagramSpec
  mistakes: KnownMistake[]
}

export interface GradeResult {
  correct: boolean
  code: MistakeCode | null
  reason?: 'not_a_number' | 'wrong_number' | 'unit_mismatch' | 'units_missing' | 'units_wrong_power'
}

export type QuestionDraft = Omit<Question, 'id' | 'templateId' | 'topic' | 'difficulty' | 'seed'>

export interface Template {
  id: string
  topic: Topic
  generate(rng: import('./rng').Rng, difficulty: Difficulty): QuestionDraft
}

export function diagramLabels(spec: DiagramSpec): string[] {
  return Object.values(spec.labels)
}

export function formatAnswer(answer: Answer): string {
  return answer.unit === '₹' ? `₹${answer.value}` : `${answer.value} ${answer.unit}`
}
