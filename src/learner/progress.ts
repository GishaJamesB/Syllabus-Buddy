import type { Idea, Lesson, LessonDifficulty } from '../content/lessonSchema'
import { generate } from '../maths/registry'
import type { GradeResult, MistakeCode, Question, Unit } from '../maths/types'

export const SCHEMA_VERSION = 1
export const MISSES_BEFORE_HELP = 3
export const NICKNAME_MAX = 20

export interface Attempt {
  ideaId: string
  templateId: string
  difficulty: LessonDifficulty
  seed: number
  answerText: string
  unit: Unit | null
  correct: boolean
  reason: GradeResult['reason'] | null
  code: MistakeCode | null
  at: number
}

export interface IdeaState {
  questionSeed: number
  stepsShown: boolean
}

export interface Progress {
  schemaVersion: typeof SCHEMA_VERSION
  currentIdeaId: string | null
  passedIdeaIds: string[]
  ideas: Record<string, IdeaState>
  attempts: Attempt[]
  tests: unknown[]
  updatedAt: number
}

export interface Profile {
  id: string
  nickname: string
  createdAt: number
  progress: Progress
}

export type NicknameCheck = { ok: true; nickname: string; id: string } | { ok: false; error: string }

export function normalizeNickname(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ')
}

export function nicknameId(nickname: string): string {
  return normalizeNickname(nickname).toLocaleLowerCase('en')
}

export function checkNickname(raw: string, existingIds: string[]): NicknameCheck {
  const nickname = normalizeNickname(raw)
  const length = [...nickname].length
  if (length === 0) return { ok: false, error: 'Type a nickname' }
  if (length > NICKNAME_MAX) return { ok: false, error: `Keep it to ${NICKNAME_MAX} letters or fewer` }
  if (!/^[\p{L}\p{N} ]+$/u.test(nickname)) return { ok: false, error: 'Use only letters, numbers and spaces' }
  const id = nicknameId(nickname)
  if (existingIds.includes(id)) return { ok: false, error: 'That nickname is taken on this device' }
  return { ok: true, nickname, id }
}

export function newProgress(lesson: Lesson, now: number): Progress {
  return {
    schemaVersion: SCHEMA_VERSION,
    currentIdeaId: lesson.ideas[0]?.id ?? null,
    passedIdeaIds: [],
    ideas: {},
    attempts: [],
    tests: [],
    updatedAt: now,
  }
}

export function newProfile(nickname: string, id: string, lesson: Lesson, now: number): Profile {
  return { id, nickname, createdAt: now, progress: newProgress(lesson, now) }
}

export const workedSeed = (idea: Idea): number => idea.order * 1000

export function workedExample(idea: Idea): Question {
  return generate(idea.workedExample.templateId, idea.workedExample.difficulty, workedSeed(idea))
}

export function ideaState(progress: Progress, idea: Idea): IdeaState {
  return progress.ideas[idea.id] ?? { questionSeed: firstCheckSeed(idea), stepsShown: false }
}

export function checkQuestion(idea: Idea, seed: number): Question {
  return generate(idea.checkQuestion.templateId, idea.checkQuestion.difficulty, seed)
}

function seedAvoiding(idea: Idea, from: number, avoid: Set<number>): number {
  for (let seed = from; seed < from + 1000; seed++) {
    if (!avoid.has(checkQuestion(idea, seed).answer.value)) return seed
  }
  return from
}

export function firstCheckSeed(idea: Idea): number {
  return seedAvoiding(idea, workedSeed(idea) + 1, new Set([workedExample(idea).answer.value]))
}

export function freshSeed(idea: Idea, currentSeed: number): number {
  const avoid = new Set([checkQuestion(idea, currentSeed).answer.value, workedExample(idea).answer.value])
  return seedAvoiding(idea, currentSeed + 1, avoid)
}

function attemptsSinceLastPass(progress: Progress, ideaId: string): Attempt[] {
  const forIdea = progress.attempts.filter((a) => a.ideaId === ideaId)
  let lastPass = -1
  forIdea.forEach((a, i) => {
    if (a.correct) lastPass = i
  })
  return forIdea.slice(lastPass + 1)
}

export function missCount(progress: Progress, idea: Idea): number {
  const { questionSeed } = ideaState(progress, idea)
  return attemptsSinceLastPass(progress, idea.id).filter(
    (a) => a.seed === questionSeed && !a.correct && a.reason !== 'not_a_number',
  ).length
}

export const isPassed = (progress: Progress, ideaId: string): boolean => progress.passedIdeaIds.includes(ideaId)

export function passingAttempt(progress: Progress, idea: Idea): Attempt | null {
  if (!isPassed(progress, idea.id)) return null
  const { questionSeed } = ideaState(progress, idea)
  for (let i = progress.attempts.length - 1; i >= 0; i--) {
    const a = progress.attempts[i]
    if (a.ideaId === idea.id && a.correct && a.seed === questionSeed) return a
  }
  return null
}

function touch(progress: Progress, now: number, changes: Partial<Progress>): Progress {
  return { ...progress, ...changes, updatedAt: now }
}

export function recordAttempt(
  progress: Progress,
  idea: Idea,
  input: { text: string; unit: Unit | null },
  result: GradeResult,
  now: number,
): Progress {
  const { questionSeed } = ideaState(progress, idea)
  const attempt: Attempt = {
    ideaId: idea.id,
    templateId: idea.checkQuestion.templateId,
    difficulty: idea.checkQuestion.difficulty,
    seed: questionSeed,
    answerText: input.text,
    unit: input.unit,
    correct: result.correct,
    reason: result.reason ?? null,
    code: result.code,
    at: now,
  }
  const passedIdeaIds =
    result.correct && !isPassed(progress, idea.id) ? [...progress.passedIdeaIds, idea.id] : progress.passedIdeaIds
  return touch(progress, now, {
    attempts: [...progress.attempts, attempt],
    passedIdeaIds,
    ideas: { ...progress.ideas, [idea.id]: ideaState(progress, idea) },
  })
}

export function showSteps(progress: Progress, idea: Idea, now: number): Progress {
  return touch(progress, now, { ideas: { ...progress.ideas, [idea.id]: { ...ideaState(progress, idea), stepsShown: true } } })
}

export function nextQuestion(progress: Progress, idea: Idea, now: number): Progress {
  const seed = freshSeed(idea, ideaState(progress, idea).questionSeed)
  return touch(progress, now, { ideas: { ...progress.ideas, [idea.id]: { questionSeed: seed, stepsShown: false } } })
}

export function goTo(progress: Progress, ideaId: string | null, now: number): Progress {
  return touch(progress, now, { currentIdeaId: ideaId })
}

export function canGoNext(progress: Progress, ideaId: string): boolean {
  return isPassed(progress, ideaId)
}

export function finish(progress: Progress, now: number): Progress {
  return goTo(progress, null, now)
}

export function startAgain(progress: Progress, lesson: Lesson, now: number): Progress {
  return touch(progress, now, { currentIdeaId: lesson.ideas[0]?.id ?? null, passedIdeaIds: [], ideas: {} })
}

export type ResumeTarget = { kind: 'idea'; idea: Idea; index: number } | { kind: 'complete' }

export function resumeTarget(lesson: Lesson, progress: Progress): ResumeTarget {
  const current = lesson.ideas.findIndex((i) => i.id === progress.currentIdeaId)
  if (current >= 0) return { kind: 'idea', idea: lesson.ideas[current], index: current }
  const firstUnpassed = lesson.ideas.findIndex((i) => !isPassed(progress, i.id))
  if (firstUnpassed < 0) return { kind: 'complete' }
  return { kind: 'idea', idea: lesson.ideas[firstUnpassed], index: firstUnpassed }
}

export function mistakeHistory(profile: Profile): Partial<Record<MistakeCode, number>> {
  const counts: Partial<Record<MistakeCode, number>> = {}
  for (const a of profile.progress.attempts) {
    if (!a.correct && a.code) counts[a.code] = (counts[a.code] ?? 0) + 1
  }
  return counts
}
