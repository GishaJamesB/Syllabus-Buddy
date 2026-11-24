import { useState, type FormEvent } from 'react'
import type { Question, Unit } from '../maths/types'
import { bigBtn } from './styles'

const UNIT_CHOICES: Unit[] = ['cm', 'm', 'sq cm', 'sq m']

interface Props {
  question: Question
  answered: { text: string; unit: Unit | null } | null
  onSubmit: (input: { text: string; unit: Unit | null }) => void
}

export function AnswerBox({ question, answered, onSubmit }: Props) {
  const dollars = question.answer.unit === 'S$'
  const [text, setText] = useState(answered?.text ?? '')
  const [unit, setUnit] = useState<Unit | null>(answered?.unit ?? null)
  const locked = answered !== null

  function submit(e: FormEvent) {
    e.preventDefault()
    if (locked) return
    onSubmit({ text, unit: dollars ? 'S$' : unit })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label htmlFor="answer" className="block text-lg font-extrabold">
        {dollars ? 'Your answer in dollars' : 'Your answer'}
      </label>
      <div className="flex items-center gap-2">
        {dollars && (
          <span className="text-2xl font-extrabold" aria-hidden="true">
            S$
          </span>
        )}
        <input
          id="answer"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={text}
          readOnly={locked}
          onChange={(e) => setText(e.target.value)}
          className="w-full max-w-48 rounded-xl border-2 border-purple/40 bg-white px-4 py-3 text-2xl font-bold focus:border-purple focus:outline-none read-only:bg-teal-soft"
        />
      </div>
      {!dollars && (
        <fieldset>
          <legend className="mb-2 text-lg font-extrabold">Unit</legend>
          <div className="flex flex-wrap gap-2">
            {UNIT_CHOICES.map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={unit === u}
                disabled={locked}
                onClick={() => setUnit(unit === u ? null : u)}
                className={`min-w-20 rounded-full border-2 px-5 py-3 text-lg font-extrabold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-purple ${
                  unit === u ? 'border-purple bg-purple text-white' : 'border-purple/40 bg-white text-purple hover:bg-purple-soft'
                } disabled:cursor-not-allowed`}
              >
                {u}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {!locked && (
        <button type="submit" className={bigBtn}>
          Check my answer
        </button>
      )}
    </form>
  )
}
