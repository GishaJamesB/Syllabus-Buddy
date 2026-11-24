import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import lessonJson from '../content/ch6.lesson.json'
import { validateLesson, type Lesson } from '../content/lessonSchema'
import type { BuddyReply } from '../ai/buddy'
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
import {
  goTo,
  ideaState,
  newProfile,
  newProgress,
  nextQuestion,
  recordAttempt,
  recordBuddyTurn,
  resumeTarget,
  SCHEMA_VERSION,
  showSteps,
  startAgain,
  withDefaults,
  type BuddyTurn,
  type Profile,
  type Progress,
} from './progress'
import { memoryStore, NicknameTakenError, openStore, type Store } from './store'
import { smallBtn } from './styles'

export function loadLesson(data: unknown): Lesson | null {
  return validateLesson(data).ok ? (data as Lesson) : null
}

interface Props {
  lessonData?: unknown
  open?: () => Promise<Store>
  buddy?: BuddyService
}

const defaultOpen = () => openStore()

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

export default function LearnerApp({ lessonData = lessonJson, open = defaultOpen, buddy = firebaseBuddy() }: Props) {
  const lesson = useMemo(() => loadLesson(lessonData), [lessonData])
  const [store, setStore] = useState<Store | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const current = useRef<Profile | null>(null)
  const brain = useBrainStatus(buddy)
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
    const next = { ...prev, progress: change(prev.progress, Date.now()) }
    show(next)
    store.saveProfile(next).catch(() => setSaveFailed(true))
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
    show(
      p.progress?.schemaVersion === SCHEMA_VERSION
        ? { ...p, progress: withDefaults(p.progress) }
        : { ...p, progress: newProgress(activeLesson, Date.now()) },
    )
  }

  async function add(nickname: string, id: string): Promise<string | null> {
    const p = newProfile(nickname, id, activeLesson, Date.now())
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
    show(p)
    return null
  }

  async function switchLearner() {
    turns.clear()
    show(null)
    try {
      setProfiles(await activeStore.listProfiles())
    } catch {
      setSaveFailed(true)
    }
  }

  const banner = !store.persistent || saveFailed

  let body
  if (!profile) {
    body = <NicknameScreen profiles={profiles} onPick={pick} onAdd={add} buddy={buddy} />
  } else {
    const target = resumeTarget(lesson, profile.progress)
    if (target.kind === 'complete') {
      body = (
        <CompleteScreen
          nickname={profile.nickname}
          chapterTitle={lesson.title}
          onStartAgain={() => update((p, now) => startAgain(p, activeLesson, now))}
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
          buddyView={turns.view}
          brain={brain}
          previousTitle={index > 0 ? lesson.ideas[index - 1].title : null}
          onAsk={(text, question) => void turns.send(contextFor(), { kind: 'ask', turn: { idea, question, text } })}
        />
      )
    }
  }

  return (
    <Shell
      learner={profile?.nickname ?? null}
      onSwitch={switchLearner}
      banner={banner}
      credit={lesson.source.credit}
    >
      {body}
    </Shell>
  )
}

interface ShellProps {
  children: ReactNode
  learner?: string | null
  onSwitch?: () => void
  banner?: boolean
  credit?: string
}

function Shell({ children, learner = null, onSwitch, banner = false, credit }: ShellProps) {
  return (
    <div className="min-h-screen font-sans">
      <header className="bg-purple text-white shadow-card">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <h1 className="text-2xl font-extrabold">Syllabus Buddy</h1>
          {learner && onSwitch && (
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold">Hi, {learner}!</span>
              <button type="button" className={smallBtn} onClick={onSwitch}>
                Switch learner
              </button>
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
