import { useState } from 'react'
import { generate } from '../maths/registry'
import type { Unit } from '../maths/types'
import { mistakeText } from './mistakeText'
import type { Attempt } from './progress'
import { softBtn } from './styles'

export const RECENT_ANSWERS = 10
export const MORE_ANSWERS = 20

function questionText(attempt: Attempt): string {
  try {
    return generate(attempt.templateId, attempt.difficulty, attempt.seed).prompt
  } catch {
    return 'A question that is no longer in the lesson'
  }
}

export function answeredAt(at: number): string {
  return new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function typedAnswer(text: string, unit: Unit | null): string {
  const value = text.trim() || '(blank)'
  if (!unit) return value
  return unit === 'S$' ? `S$${value}` : `${value} ${unit}`
}

const answerText = ({ answerText: text, unit }: Attempt) => typedAnswer(text, unit)

function resultText(attempt: Attempt): string {
  if (attempt.correct) return '✔ Right'
  return attempt.code ? `✘ ${mistakeText[attempt.code]}` : '✘ Not right'
}

export function RecentAnswers({ attempts }: { attempts: Attempt[] }) {
  const [shown, setShown] = useState(RECENT_ANSWERS)
  const recent = attempts.slice(-shown).reverse()
  const more = attempts.length - recent.length
  return (
    <details>
      <summary className="cursor-pointer text-xl font-extrabold">Recent answers</summary>
      {recent.length === 0 ? (
        <p className="mt-2 text-lg">No answers yet.</p>
      ) : (
        <ol aria-label="Recent answers" className="mt-2 space-y-3">
          {recent.map((a, i) => (
            <li key={`${a.at}-${i}`} className="rounded-xl bg-purple-soft px-4 py-3">
              <p className="text-sm">{answeredAt(a.at)}</p>
              <p>{questionText(a)}</p>
              <p className="mt-1 font-bold">Answer: {answerText(a)}</p>
              <p className="mt-1">{resultText(a)}</p>
            </li>
          ))}
        </ol>
      )}
      {more > 0 && (
        <button type="button" className={`${softBtn} mt-3`} onClick={() => setShown((n) => n + MORE_ANSWERS)}>
          Show {Math.min(more, MORE_ANSWERS)} more
        </button>
      )}
    </details>
  )
}
