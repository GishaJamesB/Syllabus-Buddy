import { useEffect, useMemo, useRef, useState } from 'react'
import { Diagram } from '../diagrams/Diagram'
import { AnswerBox } from './AnswerBox'
import { bigBtn, card, softBtn } from './styles'
import { nextUnanswered, remainingMs, testQuestion, type TestAnswer, type TestRecord } from './test'

interface Props {
  test: TestRecord
  now: () => number
  onAnswer: (index: number, input: TestAnswer | null) => void
  onFinish: () => void
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function TestScreen({ test, now, onAnswer, onFinish }: Props) {
  const [shown, setShown] = useState(() => Math.max(0, nextUnanswered(test)))
  const [clock, setClock] = useState(() => now())
  const ended = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const question = useMemo(() => testQuestion(test.questions[shown]), [test.questions, shown])
  const answered = test.results[shown] !== null
  const remaining = remainingMs(test, clock)
  const total = test.questions.length

  function end() {
    if (ended.current) return
    ended.current = true
    onFinish()
  }

  useEffect(() => {
    const timer = setInterval(() => setClock(now()), 1000)
    return () => clearInterval(timer)
  }, [now])

  useEffect(() => {
    if (remaining <= 0) end()
  })

  useEffect(() => {
    heading.current?.focus()
  }, [shown])

  function moveOn() {
    const next = test.results.findIndex((r, i) => r === null && i !== shown)
    if (next < 0) end()
    else setShown(next)
  }

  function skip() {
    onAnswer(shown, null)
    moveOn()
  }

  const lastMinute = remaining <= 60_000

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 ref={heading} tabIndex={-1} className="text-2xl font-extrabold text-purple focus:outline-none">
          Question {shown + 1} of {total}
        </h2>
        <p
          role="timer"
          aria-live="off"
          className={`rounded-full px-4 py-2 text-lg font-extrabold ${lastMinute ? 'bg-danger-soft text-danger motion-safe:animate-pulse' : 'bg-sun/40'}`}
        >
          {formatClock(remaining)} left
        </p>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {lastMinute && remaining > 0 ? 'One minute left' : ''}
      </div>

      <section className={`${card} space-y-4`}>
        <p className="text-lg font-bold">{question.prompt}</p>
        <div className="mx-auto max-w-sm text-ink">
          <Diagram spec={question.diagram} />
        </div>
        <AnswerBox
          key={`${test.id}-${shown}`}
          question={question}
          answered={answered ? (test.answers[shown] ?? { text: '', unit: null }) : null}
          onSubmit={(input) => onAnswer(shown, input)}
          submitLabel="Save answer"
        />
        {answered && <p className="text-lg font-extrabold text-teal">Answer saved</p>}
      </section>

      <nav className="flex items-center justify-between gap-3" aria-label="Test">
        <button type="button" className={softBtn} onClick={skip} disabled={answered}>
          Skip
        </button>
        <button type="button" className={bigBtn} onClick={moveOn} disabled={!answered}>
          Next
        </button>
      </nav>
    </div>
  )
}
