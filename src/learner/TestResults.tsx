import { useEffect, useRef, useState } from 'react'
import { missTurn, type BuddyReply } from '../ai/buddy'
import type { BuddyService } from '../ai/useBuddy'
import type { Lesson } from '../content/lessonSchema'
import { formatAnswer, type GradeResult, type MistakeCode } from '../maths/types'
import { Confetti } from '../ui/Confetti'
import { Badge } from './BuddyPanel'
import { feedbackFor } from './feedback'
import type { BuddyTurn } from './progress'
import { Steps } from './Steps'
import { bigBtn, card, softBtn } from './styles'
import { score, testQuestion, type TestRecord } from './test'

export const CONFETTI_SCORE = 8
const NO_ANSWER = 'No answer given'

interface Props {
  test: TestRecord
  lesson: Lesson
  buddy: BuddyService
  onBuddyTurn: (turn: Omit<BuddyTurn, 'at'>) => void
  onDone: () => void
}

type Why = { reply: BuddyReply | null }

export function TestResults({ test, lesson, buddy, onBuddyTurn, onDone }: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  const live = useRef(true)
  const [why, setWhy] = useState<Record<number, Why>>({})
  const marks = score(test)
  const total = test.questions.length

  useEffect(() => {
    heading.current?.focus()
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  async function askWhy(index: number) {
    const ref = test.questions[index]
    const idea = lesson.ideas.find((i) => i.id === ref.ideaId)
    const stored = test.results[index]
    if (!idea || !stored) {
      setWhy((w) => ({ ...w, [index]: { reply: { outcome: 'failed' } } }))
      return
    }
    const question = testQuestion(ref)
    const answer = test.answers[index]
    const blank = answer === null
    const input = answer ?? { text: '', unit: null }
    const result: GradeResult = blank
      ? { correct: false, reason: 'wrong_number', code: null }
      : { correct: false, reason: (stored.reason ?? 'wrong_number') as GradeResult['reason'], code: stored.code }
    const fallback = blank ? NO_ANSWER : feedbackFor(result, question).message
    setWhy((w) => ({ ...w, [index]: { reply: null } }))
    let reply: BuddyReply
    try {
      reply = await missTurn(await buddy.model(), { idea, question, input, result, fallback })
    } catch {
      reply = { outcome: 'failed' }
    }
    if (!live.current) return
    setWhy((w) => ({ ...w, [index]: { reply } }))
    const answeredReply = reply.outcome !== 'failed' ? reply : null
    onBuddyTurn({
      ideaId: idea.id,
      templateId: ref.templateId,
      seed: ref.seed,
      kind: 'miss',
      reason: result.reason ?? null,
      code: result.code,
      intent: answeredReply?.intent ?? null,
      misconception: (answeredReply?.misconception as MistakeCode | null | undefined) ?? null,
      source: answeredReply?.source ?? null,
      outcome: reply.outcome,
    })
  }

  return (
    <div className="space-y-5">
      <section className={`${card} space-y-3 text-center`}>
        <h2 ref={heading} tabIndex={-1} className="text-3xl font-extrabold text-purple focus:outline-none">
          Test results
        </h2>
        <p className="text-4xl font-extrabold text-orange">
          {marks} out of {total}
        </p>
        <button type="button" className={bigBtn} onClick={onDone}>
          Back to lesson
        </button>
      </section>

      <ol className="space-y-4">
        {test.questions.map((ref, i) => {
          const question = testQuestion(ref)
          const result = test.results[i]
          const answer = test.answers[i]
          const correct = result?.correct === true
          const feedback =
            !correct && answer && result
              ? feedbackFor({ correct: false, reason: (result.reason ?? 'wrong_number') as GradeResult['reason'], code: result.code }, question)
              : null
          const asked = why[i]
          return (
            <li key={i} className={`${card} space-y-3`} aria-label={`Question ${i + 1}`}>
              <p className="text-lg font-bold">
                {i + 1}. {question.prompt}
              </p>
              <p className="text-lg">
                Your answer: <span className="font-extrabold">{answer ? `${answer.text} ${answer.unit ?? ''}`.trim() : 'blank'}</span>{' '}
                <span className={correct ? 'text-teal' : 'text-danger'} aria-hidden="true">
                  {correct ? '✔' : '✘'}
                </span>
                <span className="sr-only">{correct ? 'Right' : 'Wrong'}</span>
              </p>
              {!correct && (
                <div className="space-y-3 rounded-xl bg-danger-soft/50 px-4 py-3">
                  <p className="font-extrabold">{feedback ? feedback.message : NO_ANSWER}</p>
                  {feedback?.hint && <p className="font-bold">{feedback.hint}</p>}
                  <p className="text-lg">
                    Correct answer: <span className="font-extrabold">{formatAnswer(question.answer)}</span>
                  </p>
                  <Steps steps={question.steps} />
                  {(!asked || asked.reply?.outcome === 'failed') && (
                    <button type="button" className={softBtn} onClick={() => void askWhy(i)}>
                      Why?
                    </button>
                  )}
                  <div role="status" aria-live="polite">
                    {asked && <WhyReply reply={asked.reply} />}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {marks >= CONFETTI_SCORE && <Confetti />}
    </div>
  )
}

function WhyReply({ reply }: { reply: BuddyReply | null }) {
  if (!reply) return <p>Buddy is thinking…</p>
  if (reply.outcome === 'failed') return <p>Buddy is resting right now</p>
  return (
    <p className="rounded-xl bg-purple-soft px-4 py-3 text-lg font-bold">
      {reply.clue}
      <Badge source={reply.source} />
    </p>
  )
}
