import { useEffect, useMemo, useRef, useState } from 'react'
import type { BrainStatus, BuddyView } from '../ai/useBuddy'
import type { Idea } from '../content/lessonSchema'
import { Diagram } from '../diagrams/Diagram'
import { grade } from '../maths/grade'
import type { GradeResult, Question, Unit } from '../maths/types'
import { Confetti } from '../ui/Confetti'
import { AnswerBox } from './AnswerBox'
import { BuddyPanel } from './BuddyPanel'
import { feedbackFor, type Feedback } from './feedback'
import { Steps } from './Steps'
import { TutorCard, type TutorHooks } from './TutorCard'
import {
  checkQuestion,
  hasTutorSession,
  ideaState,
  isPassed,
  missCount,
  MISSES_BEFORE_HELP,
  passingAttempt,
  workedExample,
  type Progress,
} from './progress'
import { bigBtn, card, softBtn } from './styles'

interface Props {
  idea: Idea
  index: number
  total: number
  progress: Progress
  onAnswer: (input: { text: string; unit: Unit | null }, result: GradeResult, question: Question) => void
  onShowSteps: () => void
  onNewQuestion: () => void
  onBack: () => void
  onNext: () => void
  buddyView: BuddyView | null
  brain: BrainStatus
  previousTitle: string | null
  onAsk: (text: string, question: Question) => void
  tutor?: TutorHooks
}

const TONE_CLASS: Record<Feedback['tone'], string> = {
  correct: 'bg-teal-soft text-teal',
  miss: 'bg-danger-soft text-danger',
  retry: 'bg-warn-soft text-ink',
}

export function IdeaScreen({
  idea,
  index,
  total,
  progress,
  onAnswer,
  onShowSteps,
  onNewQuestion,
  onBack,
  onNext,
  buddyView,
  brain,
  previousTitle,
  onAsk,
  tutor,
}: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  const nextButton = useRef<HTMLButtonElement>(null)
  const justPassed = useRef(false)
  const [feedback, setFeedback] = useState<{ seed: number; value: Feedback } | null>(null)
  const [celebrate, setCelebrate] = useState(0)
  const [tutorRun, setTutorRun] = useState<{ seed: number; failed: boolean } | null>(null)

  const worked = useMemo(() => workedExample(idea), [idea])
  const { questionSeed, stepsShown } = ideaState(progress, idea)
  const question = useMemo(() => checkQuestion(idea, questionSeed), [idea, questionSeed])
  const passed = isPassed(progress, idea.id)
  const passedWith = passingAttempt(progress, idea)
  const misses = missCount(progress, idea)
  const isLast = index === total - 1
  const shownFeedback = feedback?.seed === questionSeed ? feedback.value : null
  const tutorOn = tutor !== undefined && tutorRun?.seed === questionSeed
  const tutorActive = tutorOn && !tutorRun.failed
  const shownBuddy =
    buddyView?.context.ideaId === idea.id && buddyView.context.seed === questionSeed ? buddyView : null

  useEffect(() => {
    heading.current?.focus()
  }, [idea.id])

  useEffect(() => {
    if (passed && justPassed.current) {
      justPassed.current = false
      nextButton.current?.focus()
    }
  }, [passed])

  function submit(input: { text: string; unit: Unit | null }) {
    const result = grade(question, input)
    setFeedback({ seed: questionSeed, value: feedbackFor(result, question) })
    if (result.correct) {
      justPassed.current = true
      setCelebrate((c) => c + 1)
    }
    const counted = !result.correct && result.reason !== 'not_a_number'
    if (tutor && counted && misses + 1 === MISSES_BEFORE_HELP && tutorRun?.seed !== questionSeed) {
      setTutorRun({ seed: questionSeed, failed: false })
    }
    onAnswer(input, result, question)
  }

  const tutorHooks: TutorHooks | undefined = tutor && {
    ...tutor,
    onMastered: (q, input, result) => {
      justPassed.current = true
      setCelebrate((c) => c + 1)
      tutor.onMastered(q, input, result)
    },
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-1 font-extrabold" id="idea-progress">
          Idea {index + 1} of {total}
        </p>
        <div
          role="progressbar"
          aria-labelledby="idea-progress"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          className="h-4 overflow-hidden rounded-full bg-orange-soft"
        >
          <div
            className="h-full rounded-full bg-orange motion-safe:transition-all"
            style={{ width: `${((index + 1) / total) * 100}%` }}
          />
        </div>
      </div>

      <section className={card}>
        <h2 ref={heading} tabIndex={-1} className="text-3xl font-extrabold text-purple focus:outline-none">
          {idea.title}
        </h2>
        <p className="mt-3 text-lg leading-relaxed">{idea.explanation}</p>
        <ul className="mt-4 space-y-2">
          {idea.keyPoints.map((k, i) => (
            <li key={i} className="rounded-xl bg-sun/40 px-4 py-2 text-lg font-bold">
              {k}
            </li>
          ))}
        </ul>
      </section>

      <section className={card} aria-labelledby="worked-heading">
        <h3 id="worked-heading" className="text-2xl font-extrabold text-teal">
          Worked example
        </h3>
        <p className="mt-2 text-lg font-bold">{worked.prompt}</p>
        {idea.diagram && (
          <div className="mx-auto mt-3 max-w-sm text-ink">
            <Diagram spec={worked.diagram} />
          </div>
        )}
        <div className="mt-3">
          <Steps steps={worked.steps} />
        </div>
      </section>

      <section className={`${card} space-y-4`} aria-labelledby="check-heading">
        <h3 id="check-heading" className="text-2xl font-extrabold text-orange">
          Your turn
        </h3>
        <p className="text-lg font-bold">{question.prompt}</p>
        {idea.diagram && (
          <div className="mx-auto max-w-sm text-ink">
            <Diagram spec={question.diagram} />
          </div>
        )}

        {tutorActive ? null : stepsShown && !passed ? (
          <div className="space-y-4">
            <p className="text-lg font-extrabold">Here is how to solve it:</p>
            <Steps steps={question.steps} />
            <button type="button" className={bigBtn} onClick={onNewQuestion}>
              Try a new question
            </button>
          </div>
        ) : (
          <AnswerBox
            key={`${questionSeed}-${passed}`}
            question={question}
            answered={passedWith ? { text: passedWith.answerText, unit: passedWith.unit } : null}
            onSubmit={submit}
          />
        )}

        <div aria-live="polite" role="status">
          {passed && !shownFeedback && <p className="rounded-xl bg-teal-soft px-4 py-3 text-lg font-extrabold text-teal">You got this one!</p>}
          {shownFeedback && (
            <div className={`rounded-xl px-4 py-3 text-lg font-extrabold ${TONE_CLASS[shownFeedback.tone]}`}>
              <p>{shownFeedback.message}</p>
              {shownFeedback.hint && <p className="mt-1 font-bold">{shownFeedback.hint}</p>}
            </div>
          )}
        </div>

        <BuddyPanel
          view={shownBuddy}
          brain={brain}
          ideaTitle={idea.title}
          previousTitle={previousTitle}
          onGoBack={onBack}
          onAsk={(text) => onAsk(text, question)}
        />

        {tutorOn && tutorHooks && (
          <TutorCard
            key={questionSeed}
            hooks={tutorHooks}
            brain={brain}
            idea={idea}
            checkQuestion={question}
            misses={misses}
            passed={passed}
            hasPrevious={index > 0}
            onBack={onBack}
            onNext={onNext}
            onNewQuestion={onNewQuestion}
            onEnd={(outcome) => outcome === 'failed' && setTutorRun({ seed: questionSeed, failed: true })}
          />
        )}

        {tutor && !tutorOn && !passed && !stepsShown && misses >= MISSES_BEFORE_HELP && !hasTutorSession(progress, idea.id, questionSeed) && (
          <button type="button" className={softBtn} onClick={() => setTutorRun({ seed: questionSeed, failed: false })}>
            Ask the Tutor
          </button>
        )}

        {!passed && !stepsShown && !tutorActive && misses >= MISSES_BEFORE_HELP && (
          <button type="button" className={softBtn} onClick={onShowSteps}>
            Show me how
          </button>
        )}
      </section>

      <nav className="flex items-center justify-between gap-3" aria-label="Lesson">
        <button type="button" className={softBtn} onClick={onBack} disabled={index === 0}>
          Back
        </button>
        <button ref={nextButton} type="button" className={bigBtn} onClick={onNext} disabled={!passed}>
          {isLast ? 'Finish' : 'Next'}
        </button>
      </nav>

      {celebrate > 0 && <Confetti key={celebrate} />}
    </div>
  )
}
