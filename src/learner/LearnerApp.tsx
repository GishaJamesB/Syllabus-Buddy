import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import lessonJson from '../content/ch6.lesson.json'
import { validateLesson, type Lesson } from '../content/lessonSchema'
import type { BuddyReply } from '../ai/buddy'
import { testSeconds, TuningContext } from '../config/tuning'
import {
  brainRow,
  firebaseBuddy,
  useBrainStatus,
  useBuddyTurns,
  type BuddyRequest,
  type BuddyService,
  type TurnContext,
} from '../ai/useBuddy'
import type { GradeResult, MistakeCode, Question, Unit } from '../maths/types'
import { CompleteScreen } from './CompleteScreen'
import { feedbackFor } from './feedback'
import { IdeaScreen } from './IdeaScreen'
import { NicknameScreen } from './NicknameScreen'
import { ParentPanel } from './ParentPanel'
import {
  goTo,
  ideaMistakeCodes,
  ideaState,
  mistakeHistory,
  newProfile,
  newProgress,
  nextQuestion,
  recordAttempt,
  recordBuddyTurn,
  recordPracticePass,
  resumeTarget,
  saveTutorSession,
  SCHEMA_VERSION,
  showSteps,
  startAgain,
  withDefaults,
  type BuddyTurn,
  type Profile,
  type Progress,
} from './progress'
import { openLearnerStore } from './defaultOpen'
import { memoryStore, NicknameTakenError, type Store } from './store'
import { smallBtn } from './styles'
import {
  answerTest,
  buildTest,
  finishDueTest,
  finishedTests,
  markTest,
  newTest,
  remainingMs,
  saveTest,
  timeLimitFor,
  unfinishedTest,
  type TestAnswer,
  type TestQuestionRef,
} from './test'
import { TestResults } from './TestResults'
import { TestScreen } from './TestScreen'
import { TestStart } from './TestStart'

export function loadLesson(data: unknown): Lesson | null {
  return validateLesson(data).ok ? (data as Lesson) : null
}

interface Props {
  lessonData?: unknown
  open?: () => Promise<Store>
  buddy?: BuddyService
  now?: () => number
  random?: () => number
}

type View =
  | { kind: 'lesson' }
  | { kind: 'test'; running: boolean; plan: { questions: TestQuestionRef[]; timeLimitS: number } | null }
  | { kind: 'results'; testId: string }

const defaultOpen = () => openLearnerStore()

function buddyTurnFor(context: TurnContext, request: BuddyRequest, reply: BuddyReply): Omit<BuddyTurn, 'at'> {
  const miss = request.kind === 'miss' ? request.turn.result : null
  const answered = reply.outcome !== 'failed' ? reply : null
  return {
    ideaId: context.ideaId,
    templateId: request.turn.idea.checkQuestion.templateId,
    seed: context.seed,
    kind: request.kind,
    reason: miss?.reason ?? null,
    code: miss?.code ?? null,
    intent: answered?.intent ?? null,
    misconception: (answered?.misconception as MistakeCode | null | undefined) ?? null,
    source: answered?.source ?? null,
    outcome: reply.outcome,
  }
}

export default function LearnerApp({
  lessonData = lessonJson,
  open = defaultOpen,
  buddy = firebaseBuddy(),
  now = Date.now,
  random = Math.random,
}: Props) {
  const lesson = useMemo(() => loadLesson(lessonData), [lessonData])
  const [store, setStore] = useState<Store | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [view, setView] = useState<View>({ kind: 'lesson' })
  const [tutorRunning, setTutorRunning] = useState(false)
  const [grownUps, setGrownUps] = useState(false)
  const grownUpsButton = useRef<HTMLButtonElement>(null)
  const current = useRef<Profile | null>(null)
  const brain = useBrainStatus(buddy)
  const tuning = buddy.tuning()
  const seconds = testSeconds(tuning)
  const turns = useBuddyTurns({
    service: buddy,
    currentContext: () => {
      const p = current.current
      if (!p || !lesson) return null
      const target = resumeTarget(lesson, p.progress)
      if (target.kind !== 'idea') return null
      return { profileId: p.id, ideaId: target.idea.id, seed: ideaState(p.progress, target.idea).questionSeed }
    },
    onShown: (context, request, reply) =>
      update((p, now) => recordBuddyTurn(p, buddyTurnFor(context, request, reply), now)),
  })

  useEffect(() => {
    const timer = setTimeout(() => buddy.start(), 0)
    return () => clearTimeout(timer)
  }, [buddy])

  function show(next: Profile | null) {
    current.current = next
    setProfile(next)
  }

  function update(change: (progress: Progress, now: number) => Progress) {
    const prev = current.current
    if (!prev || !store) return
    const next = { ...prev, progress: change(prev.progress, now()) }
    show(next)
    store.saveProfile(next).catch(() => setSaveFailed(true))
  }

  function updateFor(profileId: string, change: (progress: Progress, now: number) => Progress) {
    if (current.current?.id === profileId) update(change)
  }

  useEffect(() => {
    let live = true
    ;(async () => {
      let s = await open()
      let list: Profile[]
      try {
        list = await s.listProfiles()
      } catch {
        s = memoryStore()
        list = []
      }
      if (!live) return
      setStore(s)
      setProfiles(list)
    })()
    return () => {
      live = false
    }
  }, [open])

  if (!lesson) {
    return (
      <Shell>
        <p role="alert" className="rounded-card bg-danger-soft p-6 text-xl font-bold text-danger">
          Oops! The lesson could not be loaded. Please ask a grown-up to check the lesson file.
        </p>
      </Shell>
    )
  }

  if (!store || !profiles) {
    return (
      <Shell>
        <p role="status" className="text-xl font-bold">
          Getting ready…
        </p>
      </Shell>
    )
  }

  const activeLesson = lesson
  const activeStore = store

  function pick(p: Profile) {
    const loaded =
      p.progress?.schemaVersion === SCHEMA_VERSION ? withDefaults(p.progress) : newProgress(activeLesson, now())
    const before = unfinishedTest(loaded)
    const progress = finishDueTest(loaded, now())
    const picked = { ...p, progress }
    show(picked)
    if (progress !== loaded) activeStore.saveProfile(picked).catch(() => setSaveFailed(true))
    if (unfinishedTest(progress)) setView({ kind: 'test', running: true, plan: null })
    else if (before) setView({ kind: 'results', testId: before.id })
    else setView({ kind: 'lesson' })
  }

  async function add(nickname: string, id: string): Promise<string | null> {
    const p = newProfile(nickname, id, activeLesson, now())
    try {
      await activeStore.addProfile(p)
    } catch (e) {
      if (e instanceof NicknameTakenError) return e.message
      const fallback = memoryStore()
      for (const existing of profiles ?? []) await fallback.addProfile(existing)
      await fallback.addProfile(p)
      setStore(fallback)
    }
    setProfiles((list) => [p, ...(list ?? [])])
    setView({ kind: 'lesson' })
    show(p)
    return null
  }

  const banner = !store.persistent || saveFailed

  function openTest() {
    const p = current.current
    if (!p) return
    turns.clear()
    const due = unfinishedTest(p.progress)
    update((progress, at) => finishDueTest(progress, at))
    const after = current.current?.progress ?? p.progress
    if (due && !unfinishedTest(after)) return setView({ kind: 'results', testId: due.id })
    const questions = due ? null : buildTest(activeLesson, after, random)
    setView({ kind: 'test', running: false, plan: questions && { questions, timeLimitS: timeLimitFor(questions, seconds) } })
  }

  function beginTest() {
    const p = current.current
    if (!p) return
    if (!unfinishedTest(p.progress)) {
      const plan = view.kind === 'test' ? view.plan : null
      const questions = plan?.questions ?? buildTest(activeLesson, p.progress, random)
      update((progress, at) => {
        const test = newTest(questions, at, random, seconds)
        return saveTest(progress, plan ? { ...test, timeLimitS: plan.timeLimitS } : test, at)
      })
    }
    setView({ kind: 'test', running: true, plan: null })
  }

  function answerQuestion(index: number, input: TestAnswer | null) {
    update((p, at) => {
      const test = unfinishedTest(p)
      return test ? saveTest(p, answerTest(test, index, input, at), at) : p
    })
  }

  function finishTest() {
    const test = current.current && unfinishedTest(current.current.progress)
    if (!test) return
    update((p, at) => saveTest(p, markTest(test, at), at))
    setView({ kind: 'results', testId: test.id })
  }

  const openRecord = profile ? unfinishedTest(profile.progress) : null
  const shownResults =
    profile && view.kind === 'results' ? (profile.progress.tests.find((t) => t.id === view.testId) ?? null) : null

  let body
  if (!profile) {
    body = <NicknameScreen profiles={profiles} onPick={pick} onAdd={add} buddy={buddy} />
  } else if (view.kind === 'test' && view.running && openRecord) {
    body = <TestScreen key={openRecord.id} test={openRecord} now={now} onAnswer={answerQuestion} onFinish={finishTest} />
  } else if (view.kind === 'test') {
    body = (
      <TestStart
        history={finishedTests(profile.progress)}
        timeLimitS={view.plan?.timeLimitS ?? null}
        remainingMs={openRecord ? remainingMs(openRecord, now()) : null}
        onBegin={beginTest}
      />
    )
  } else if (shownResults) {
    body = (
      <TestResults
        key={shownResults.id}
        test={shownResults}
        lesson={lesson}
        buddy={buddy}
        onBuddyTurn={(turn) => update((p, at) => recordBuddyTurn(p, turn, at))}
        onDone={() => setView({ kind: 'lesson' })}
      />
    )
  } else {
    const target = resumeTarget(lesson, profile.progress)
    if (target.kind === 'complete') {
      body = (
        <CompleteScreen
          nickname={profile.nickname}
          chapterTitle={lesson.title}
          history={finishedTests(profile.progress)}
          onStartAgain={() => update((p, now) => startAgain(p, activeLesson, now))}
          onTakeTest={openTest}
        />
      )
    } else {
      const { idea, index } = target
      const isLast = index === lesson.ideas.length - 1
      const learnerId = profile.id
      const contextFor = (): TurnContext => ({
        profileId: learnerId,
        ideaId: idea.id,
        seed: ideaState(current.current?.progress ?? profile.progress, idea).questionSeed,
      })
      const moveTo = (ideaId: string | null) => {
        turns.clear()
        update((p, now) => goTo(p, ideaId, now))
      }
      body = (
        <IdeaScreen
          key={idea.id}
          idea={idea}
          index={index}
          total={lesson.ideas.length}
          progress={profile.progress}
          onAnswer={(input: { text: string; unit: Unit | null }, result: GradeResult, question: Question) => {
            const context = contextFor()
            update((p, now) => recordAttempt(p, idea, input, result, now))
            if (result.correct || result.reason === 'not_a_number') return turns.clear()
            if (brainRow(brain).kind === 'needs_device') return
            const fallback = feedbackFor(result, question).message
            void turns.send(context, { kind: 'miss', turn: { idea, question, input, result, fallback } })
          }}
          onShowSteps={() => update((p, now) => showSteps(p, idea, now))}
          onNewQuestion={() => update((p, now) => nextQuestion(p, idea, now))}
          onBack={() => index > 0 && moveTo(activeLesson.ideas[index - 1].id)}
          onNext={() => (isLast ? moveTo(null) : moveTo(activeLesson.ideas[index + 1].id))}
          onTutorRunning={setTutorRunning}
          buddyView={turns.view}
          brain={brain}
          previousTitle={index > 0 ? lesson.ideas[index - 1].title : null}
          onAsk={(text, question) => void turns.send(contextFor(), { kind: 'ask', turn: { idea, question, text } })}
          tutor={{
            service: buddy,
            history: mistakeHistory(profile),
            mistakeCodes: ideaMistakeCodes(profile.progress, idea),
            onMastered: (question, input, result) =>
              updateFor(learnerId, (p, now) => recordPracticePass(p, idea, question, input, result, now)),
            onRecord: (session) => updateFor(learnerId, (p, now) => saveTutorSession(p, session, now)),
          }}
        />
      )
    }
  }

  return (
    <Shell
      learner={profile?.nickname ?? null}
      testButton={
        profile
          ? {
              label: view.kind !== 'lesson' ? 'Back to lesson' : openRecord ? 'Resume test' : 'Test',
              onClick: view.kind === 'lesson' ? openTest : () => setView({ kind: 'lesson' }),
              disabled: view.kind === 'lesson' && tutorRunning,
            }
          : undefined
      }
      grownUps={profile ? { open: grownUps, onClick: () => setGrownUps((o) => !o), ref: grownUpsButton } : undefined}
      banner={banner}
      credit={lesson.source.credit}
    >
      <TuningContext.Provider value={tuning}>
        <div className="space-y-5">
          {grownUps && profile && (
            <ParentPanel key={profile.id} profile={profile} lesson={lesson} buddy={buddy} onClose={() => {
                setGrownUps(false)
                grownUpsButton.current?.focus()
              }}
            />
          )}
          {body}
        </div>
      </TuningContext.Provider>
    </Shell>
  )
}

interface ShellProps {
  children: ReactNode
  learner?: string | null
  testButton?: { label: string; onClick: () => void; disabled: boolean }
  grownUps?: { open: boolean; onClick: () => void; ref: RefObject<HTMLButtonElement | null> }
  banner?: boolean
  credit?: string
}

function Shell({ children, learner = null, testButton, grownUps, banner = false, credit }: ShellProps) {
  return (
    <div className="min-h-screen font-sans">
      <header className="bg-purple text-white shadow-card">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <h1 className="text-2xl font-extrabold">Syllabus Buddy</h1>
          {learner && (
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold">Hi, {learner}!</span>
              {testButton && (
                <button type="button" className={smallBtn} onClick={testButton.onClick} disabled={testButton.disabled}>
                  {testButton.label}
                </button>
              )}
              {grownUps && (
                <button ref={grownUps.ref} type="button" className={smallBtn} onClick={grownUps.onClick} aria-pressed={grownUps.open}>
                  For grown-ups
                </button>
              )}
            </div>
          )}
        </div>
      </header>
      {banner && (
        <p role="status" className="bg-warn-soft px-4 py-2 text-center font-bold">
          Progress won't be saved on this device
        </p>
      )}
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      {credit && <footer className="mx-auto max-w-3xl px-4 pb-8 text-sm">{credit}</footer>}
    </div>
  )
}
