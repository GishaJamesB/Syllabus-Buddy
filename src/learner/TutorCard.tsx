import { useEffect, useRef, useState } from 'react'
import { withTimeout } from '../ai/buddy'
import { buildSummary, TUTOR_TIMEOUT_MS, TutorSession, tutorTools, type TutorOutcome, type TutorRecord, type TutorView } from '../ai/tutorAgent'
import { brainRow, type BrainStatus, type BuddyService } from '../ai/useBuddy'
import type { Idea } from '../content/lessonSchema'
import { Diagram } from '../diagrams/Diagram'
import type { GradeResult, MistakeCode, Question, Unit } from '../maths/types'
import { AgentPanel } from './AgentPanel'
import { AnswerBox } from './AnswerBox'
import { feedbackFor } from './feedback'
import type { TutorSessionRecord } from './progress'
import { Steps } from './Steps'
import { bigBtn, card } from './styles'

export interface TutorHooks {
  service: BuddyService
  history: Partial<Record<MistakeCode, number>>
  mistakeCodes: MistakeCode[]
  onMastered: (question: Question, input: { text: string; unit: Unit | null }, result: GradeResult) => void
  onRecord: (session: TutorSessionRecord) => void
}

interface Props {
  hooks: TutorHooks
  brain: BrainStatus
  idea: Idea
  checkQuestion: Question
  misses: number
  passed: boolean
  hasPrevious: boolean
  onBack: () => void
  onNext: () => void
  onNewQuestion: () => void
  onEnd: (outcome: TutorOutcome) => void
}

type CardState = { kind: 'off' } | { kind: 'failed' } | { kind: 'on'; session: TutorSession; view: TutorView }

export function TutorCard(props: Props) {
  const latest = useRef(props)
  latest.current = props
  const [state, setState] = useState<CardState>({ kind: 'off' })
  const [feedback, setFeedback] = useState<{ questionId: string; message: string } | null>(null)

  useEffect(() => {
    const { hooks, brain, idea, checkQuestion, misses, hasPrevious } = latest.current
    let live = true
    let session: TutorSession | null = null
    const startedAt = Date.now()
    const record = ({ calls, results, outcome }: TutorRecord) => {
      if (live) {
        latest.current.hooks.onRecord({ ideaId: idea.id, seed: checkQuestion.seed, startedAt, calls, results, outcome: outcome ?? 'failed' })
      }
    }
    const deviceOnly = (status: BrainStatus) => status.phase === 'ready' && status.mode === 'only_on_device'
    const fail = () => {
      if (!live) return
      if (session) return session.fail()
      setState({ kind: 'failed' })
      record({ calls: [], results: [], outcome: 'failed' })
      latest.current.onEnd('failed')
    }

    if (brain.phase === 'resting' || brainRow(brain).kind === 'needs_device' || deviceOnly(brain)) {
      fail()
      return () => {
        live = false
      }
    }

    ;(async () => {
      try {
        const model = await withTimeout(hooks.service.tutorModel(tutorTools(idea)), TUTOR_TIMEOUT_MS)
        if (!live) return
        if (deviceOnly(hooks.service.status())) return fail()
        const summary = buildSummary({ idea, misses, mistakeCodes: hooks.mistakeCodes, history: hooks.history })
        const created: TutorSession = new TutorSession({
          model,
          idea,
          checkQuestion,
          summary,
          hasPrevious,
          isPassed: () => latest.current.passed,
          onChange: (view) => {
            if (live) setState({ kind: 'on', session: created, view })
          },
          onRecord: (snapshot) => {
            record(snapshot)
            if (live && snapshot.outcome) latest.current.onEnd(snapshot.outcome)
          },
          onMastered: (question, input, result) => {
            if (live) latest.current.hooks.onMastered(question, input, result)
          },
          onNavigate: (direction) => {
            if (!live) return
            if (direction === 'back') latest.current.onBack()
            else latest.current.onNext()
          },
        })
        session = created
        setState({ kind: 'on', session: created, view: created.current })
        await created.start()
      } catch {
        fail()
      }
    })()

    return () => {
      live = false
      session?.cancel()
    }
  }, [])

  if (state.kind === 'off') {
    return (
      <section className={card} aria-label="Tutor">
        <h3 className="text-2xl font-extrabold text-purple">☁️ Tutor</h3>
        <p className="mt-2 text-lg font-bold" role="status">
          Tutor is getting ready…
        </p>
      </section>
    )
  }

  if (state.kind === 'failed') {
    return (
      <section className={card} aria-label="Tutor">
        <h3 className="text-2xl font-extrabold text-purple">☁️ Tutor</h3>
        <p className="mt-2 text-lg font-bold" role="status">
          The tutor can't help right now
        </p>
      </section>
    )
  }

  const { session, view } = state
  const awaiting = view.awaiting

  function submit(question: Question, input: { text: string; unit: Unit | null }) {
    const result = session.answer(input)
    if (result) setFeedback({ questionId: question.id, message: feedbackFor(result, question).message })
  }

  return (
    <section className={`${card} space-y-4`} aria-label="Tutor">
      <h3 className="text-2xl font-extrabold text-purple">☁️ Tutor</h3>

      {view.items.map((item, i) => {
        switch (item.kind) {
          case 'say':
            return (
              <p key={i} className="rounded-xl bg-purple-soft px-4 py-3 text-lg font-bold">
                {item.text}
              </p>
            )
          case 'practice':
            return (
              <p key={i} className="text-lg font-bold">
                {item.question.prompt}
              </p>
            )
          case 'diagram':
            return (
              <div key={i} className="mx-auto max-w-sm text-ink">
                <Diagram spec={item.question.diagram} />
              </div>
            )
          case 'steps':
            return (
              <div key={i} className="space-y-2">
                <p className="text-lg font-extrabold">Here is how to solve it:</p>
                <Steps steps={item.question.steps} />
              </div>
            )
        }
      })}

      {awaiting && <AnswerBox key={awaiting.id} question={awaiting} answered={null} onSubmit={(input) => submit(awaiting, input)} />}

      <div aria-live="polite" role="status" className="text-lg font-extrabold">
        {feedback && view.phase !== 'done' && (!awaiting || awaiting.id === feedback.questionId) && <p>{feedback.message}</p>}
        {view.phase === 'thinking' && <p>Tutor is thinking…</p>}
        {view.phase === 'busy' && <p>Tutor is busy, trying again…</p>}
        {view.outcome === 'mastered' && <p className="rounded-xl bg-teal-soft px-4 py-3 text-teal">You've got it!</p>}
        {view.outcome === 'failed' && <p>The tutor can't help right now</p>}
      </div>

      {view.outcome === 'out_of_turns' && (
        <button type="button" className={bigBtn} onClick={() => latest.current.onNewQuestion()}>
          Try a new question
        </button>
      )}

      <AgentPanel log={view.log} />
    </section>
  )
}
