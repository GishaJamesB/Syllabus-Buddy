import type { Idea } from '../content/lessonSchema'
import type { GradeResult, Question, Unit } from '../maths/types'
import { MISCONCEPTIONS, parseTurn, type Intent } from './turnSchema'

export type InferenceSource = 'on_device' | 'in_cloud'

export type TurnModel = {
  generateContent(prompt: string): Promise<{ response: { text(): string; inferenceSource?: InferenceSource } }>
}

export type Outcome = 'ok' | 'guarded' | 'failed'

export type BuddyReply =
  | {
      outcome: 'ok' | 'guarded'
      intent: Intent
      misconception: string | null
      clue: string | null
      source: InferenceSource | null
    }
  | { outcome: 'failed' }

export const CLUE_MAX = 240
export const TURN_TIMEOUT_MS = 30_000

export interface MissTurn {
  idea: Idea
  question: Question
  input: { text: string; unit: Unit | null }
  result: GradeResult
  fallback: string
}

const RULES = [
  'You are Buddy, a kind and cheerful maths helper for a child learning about perimeter and area.',
  'Rules for the clue:',
  '- Never give the answer, and never say what the answer number is.',
  '- Do not write any numbers, not even in words.',
  '- Use simple words a child understands.',
  '- Write at most 2 short sentences.',
  '- Help the child find the next step on their own.',
].join('\n')

function ideaBlock(idea: Idea, question: Question): string {
  return [
    `Idea: ${idea.title}`,
    'Key points:',
    ...idea.keyPoints.map((k) => `- ${k}`),
    `Question: ${question.prompt}`,
  ].join('\n')
}

const JSON_SHAPE =
  'Reply with JSON only, shaped as {"intent": ..., "misconception": ..., "clue": ...}. ' +
  `misconception is one of ${MISCONCEPTIONS.join(', ')}, or null.`

const UNIT_REASONS: GradeResult['reason'][] = ['units_missing', 'unit_mismatch', 'units_wrong_power']

function childAnswer({ input, result }: Pick<MissTurn, 'input' | 'result'>): string {
  if (!UNIT_REASONS.includes(result.reason)) return `The child answered: ${input.text.trim()} ${input.unit ?? '(no unit)'}`
  const problem = result.reason === 'units_missing' ? 'missing' : 'wrong'
  return `The child's number is right, but the unit is ${problem} (they wrote: ${input.unit ?? 'none'}).`
}

export function missPrompt({ idea, question, input, result }: Omit<MissTurn, 'fallback'>): string {
  return [
    RULES,
    '',
    ideaBlock(idea, question),
    childAnswer({ input, result }),
    `The checker says this is wrong. Reason: ${result.reason ?? 'wrong_number'}. Mistake code: ${result.code ?? 'unknown'}.`,
    '',
    'Give one clue that helps the child see what went wrong.',
    `${JSON_SHAPE} intent must be answer_attempt.`,
  ].join('\n')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  const parts: string[] = []
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`)
  if (rest > 0 || hundreds === 0) {
    parts.push(rest < 20 ? ONES[rest] : TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : ''))
  }
  return parts.join(' ')
}

export function numberToWords(n: number): string {
  if (n < 1000) return belowThousand(n)
  const rest = n % 1000
  return `${belowThousand(Math.floor(n / 1000))} thousand${rest ? ` ${belowThousand(rest)}` : ''}`
}

function wordsPattern(n: number): RegExp {
  const body = numberToWords(n)
    .split(' ')
    .map((word) => word.split('-').join('[-\\s]+'))
    .join('\\s+(?:and\\s+)?')
  return new RegExp(`\\b${body}\\b`, 'i')
}

export function isSafeClue(clue: string | null, answerValue: number): clue is string {
  if (clue === null || clue.trim() === '' || clue.length > CLUE_MAX) return false
  const digits = new RegExp(`(?<!\\d|\\d\\.)${escapeRegExp(String(answerValue))}(?!\\d|\\.\\d)`)
  const inWords = Number.isInteger(answerValue) && answerValue >= 0 && answerValue < 100_000 && wordsPattern(answerValue).test(clue)
  return !digits.test(clue) && !inWords
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Buddy timed out')), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

async function call(model: TurnModel, prompt: string, timeoutMs: number) {
  const { response } = await withTimeout(model.generateContent(prompt), timeoutMs)
  return { parsed: parseTurn(response.text()), source: response.inferenceSource ?? null }
}

export async function missTurn(model: TurnModel, turn: MissTurn, timeoutMs = TURN_TIMEOUT_MS): Promise<BuddyReply> {
  let reply
  try {
    reply = await call(model, missPrompt(turn), timeoutMs)
  } catch {
    return { outcome: 'failed' }
  }
  const { parsed, source } = reply
  const modelCode = parsed.ok ? parsed.turn.misconception : null
  const misconception = turn.result.code ?? modelCode
  const clue = parsed.ok ? parsed.turn.clue : null
  if (parsed.ok && isSafeClue(clue, turn.question.answer.value)) {
    return { outcome: 'ok', intent: 'answer_attempt', misconception, clue, source }
  }
  return { outcome: 'guarded', intent: 'answer_attempt', misconception, clue: turn.fallback, source }
}
