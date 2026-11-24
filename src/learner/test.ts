import { DIFFICULTIES, type Lesson, type LessonDifficulty } from '../content/lessonSchema'
import { grade } from '../maths/grade'
import { generate } from '../maths/registry'
import type { GradeResult, MistakeCode, Question, Unit } from '../maths/types'
import type { Progress } from './progress'

export const TEST_LENGTH = 10
export const MIN_WEAK = 4
export const RECENT_PER_SOURCE = 20
export const TEST_SEED_MIN = 1_000_000
const SEED_TRIES = 50

export const testTimer: Record<LessonDifficulty, number> = { easy: 90, medium: 120, hard: 150 }

export interface TestQuestionRef {
  templateId: string
  difficulty: LessonDifficulty
  seed: number
  ideaId: string
}

export interface TestAnswer {
  text: string
  unit: Unit | null
}

export interface TestResult {
  correct: boolean
  reason: GradeResult['reason'] | 'blank' | null
  code: MistakeCode | null
}

export interface TestRecord {
  id: string
  startedAt: number
  finishedAt: number | null
  timeLimitS: number
  questions: TestQuestionRef[]
  answers: (TestAnswer | null)[]
  results: (TestResult | null)[]
}

export const BLANK_RESULT: TestResult = { correct: false, reason: 'blank', code: null }

interface TemplateInfo {
  templateId: string
  difficulty: LessonDifficulty
  ideaId: string
}

export function lessonTemplates(lesson: Lesson): TemplateInfo[] {
  const byId = new Map<string, TemplateInfo>()
  for (const idea of lesson.ideas) {
    const { templateId, difficulty } = idea.checkQuestion
    if (!byId.has(templateId)) byId.set(templateId, { templateId, difficulty, ideaId: idea.id })
  }
  const ordered: TemplateInfo[] = []
  const seen = new Set<string>()
  for (const idea of lesson.ideas) {
    for (const templateId of [idea.checkQuestion.templateId, ...idea.practiceTemplates]) {
      if (seen.has(templateId)) continue
      seen.add(templateId)
      const fromCheck = byId.get(templateId)
      ordered.push(
        fromCheck
          ? { templateId, difficulty: fromCheck.difficulty, ideaId: fromCheck.ideaId }
          : { templateId, difficulty: idea.checkQuestion.difficulty, ideaId: idea.id },
      )
    }
  }
  return ordered
}

interface Miss {
  templateId: string
  difficulty: LessonDifficulty
  at: number
}

function parseDifficulty(questionId: string): LessonDifficulty | null {
  const part = questionId.split(':')[1]
  return (DIFFICULTIES as readonly string[]).includes(part) ? (part as LessonDifficulty) : null
}

function recentMisses(lesson: Lesson, progress: Progress): Miss[] {
  const defaults = new Map(lessonTemplates(lesson).map((t) => [t.templateId, t.difficulty]))
  const fromAttempts = progress.attempts
    .slice(-RECENT_PER_SOURCE)
    .filter((a) => !a.correct && a.reason !== 'not_a_number')
    .map((a): Miss => ({ templateId: a.templateId, difficulty: a.difficulty, at: a.at }))

  const tutorEntries = (progress.tutorSessions ?? []).flatMap((s) => (s.results ?? []).map((r) => ({ r, at: s.startedAt })))
  const fromTutor = tutorEntries
    .slice(-RECENT_PER_SOURCE)
    .filter(({ r }) => !r.correct)
    .map(({ r, at }): Miss => ({
      templateId: r.templateId,
      difficulty: parseDifficulty(r.questionId) ?? defaults.get(r.templateId) ?? 'medium',
      at,
    }))

  const testEntries = (progress.tests ?? [])
    .filter((t) => t.finishedAt !== null)
    .flatMap((t) => t.questions.map((q, i) => ({ q, result: t.results[i], at: t.finishedAt as number })))
  const fromTests = testEntries
    .slice(-RECENT_PER_SOURCE)
    .filter(({ result }) => result !== null && !result.correct)
    .map(({ q, at }): Miss => ({ templateId: q.templateId, difficulty: q.difficulty, at }))

  return [...fromAttempts, ...fromTutor, ...fromTests]
}

export function weakTemplates(lesson: Lesson, progress: Progress): { templateId: string; difficulty: LessonDifficulty }[] {
  const latest = new Map<string, Miss>()
  for (const miss of recentMisses(lesson, progress)) {
    const seen = latest.get(miss.templateId)
    if (!seen || miss.at >= seen.at) latest.set(miss.templateId, miss)
  }
  return lessonTemplates(lesson)
    .filter((t) => latest.has(t.templateId))
    .map((t) => ({ templateId: t.templateId, difficulty: (latest.get(t.templateId) as Miss).difficulty }))
}

function randomSeed(random: () => number): number {
  return TEST_SEED_MIN + Math.floor(random() * (2 ** 31 - TEST_SEED_MIN))
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function buildTest(lesson: Lesson, progress: Progress, random: () => number): TestQuestionRef[] {
  const templates = lessonTemplates(lesson)
  const ideaFor = new Map(templates.map((t) => [t.templateId, t.ideaId]))
  const weakInOrder = weakTemplates(lesson, progress)
  const weakIds = new Set(weakInOrder.map((w) => w.templateId))
  const weak = shuffle(weakInOrder, random)
  const weakCount = weak.length ? Math.min(TEST_LENGTH, Math.max(MIN_WEAK, weak.length)) : 0
  const others = templates.filter((t) => !weakIds.has(t.templateId))
  const fill = shuffle(others.length ? others : templates, random)

  const slots: { templateId: string; difficulty: LessonDifficulty }[] = []
  for (let i = 0; i < weakCount; i++) slots.push(weak[i % weak.length])
  for (let i = 0; slots.length < TEST_LENGTH; i++) slots.push(fill[i % fill.length])

  const usedValues = new Map<string, Set<number>>()
  const usedSeeds = new Map<string, Set<number>>()
  const questions = slots.map(({ templateId, difficulty }): TestQuestionRef => {
    const values = usedValues.get(templateId) ?? new Set<number>()
    const seeds = usedSeeds.get(templateId) ?? new Set<number>()
    let seed = randomSeed(random)
    for (let tries = 1; tries < SEED_TRIES && values.has(generate(templateId, difficulty, seed).answer.value); tries++) {
      seed = randomSeed(random)
    }
    if (values.has(generate(templateId, difficulty, seed).answer.value)) {
      while (seeds.has(seed)) seed = randomSeed(random)
    }
    values.add(generate(templateId, difficulty, seed).answer.value)
    seeds.add(seed)
    usedValues.set(templateId, values)
    usedSeeds.set(templateId, seeds)
    return { templateId, difficulty, seed, ideaId: ideaFor.get(templateId) as string }
  })
  return shuffle(questions, random)
}

export function timeLimitFor(questions: TestQuestionRef[], seconds: Record<LessonDifficulty, number> = testTimer): number {
  return questions.reduce((sum, q) => sum + seconds[q.difficulty], 0)
}

export function newTest(
  questions: TestQuestionRef[],
  now: number,
  random: () => number = Math.random,
  seconds: Record<LessonDifficulty, number> = testTimer,
): TestRecord {
  return {
    id: `test-${now}-${Math.floor(random() * 1e9).toString(36)}`,
    startedAt: now,
    finishedAt: null,
    timeLimitS: timeLimitFor(questions, seconds),
    questions,
    answers: questions.map(() => null),
    results: questions.map(() => null),
  }
}

export const testQuestion = (ref: TestQuestionRef): Question => generate(ref.templateId, ref.difficulty, ref.seed)

export function remainingMs(test: TestRecord, now: number): number {
  return test.startedAt + test.timeLimitS * 1000 - now
}

export function nextUnanswered(test: TestRecord): number {
  return test.results.findIndex((r) => r === null)
}

export function answerTest(test: TestRecord, index: number, input: TestAnswer | null, now: number): TestRecord {
  if (test.finishedAt !== null || test.results[index] !== null || remainingMs(test, now) <= 0) return test
  const answers = [...test.answers]
  const results = [...test.results]
  if (input === null || input.text.trim() === '') {
    answers[index] = null
    results[index] = BLANK_RESULT
  } else {
    const result = grade(testQuestion(test.questions[index]), input)
    answers[index] = input
    results[index] = { correct: result.correct, reason: result.reason ?? null, code: result.code }
  }
  return { ...test, answers, results }
}

export function markTest(test: TestRecord, now: number): TestRecord {
  if (test.finishedAt !== null) return test
  return { ...test, results: test.results.map((r) => r ?? BLANK_RESULT), finishedAt: now }
}

export function isDue(test: TestRecord, now: number): boolean {
  return test.finishedAt === null && (nextUnanswered(test) < 0 || remainingMs(test, now) <= 0)
}

export const score = (test: TestRecord): number => test.results.filter((r) => r?.correct).length

export function unfinishedTest(progress: Progress): TestRecord | null {
  return (progress.tests ?? []).find((t) => t.finishedAt === null) ?? null
}

export function finishedTests(progress: Progress, limit = 5): TestRecord[] {
  return (progress.tests ?? [])
    .filter((t) => t.finishedAt !== null)
    .sort((a, b) => (b.finishedAt as number) - (a.finishedAt as number))
    .slice(0, limit)
}

export function saveTest(progress: Progress, test: TestRecord, now: number): Progress {
  const tests = progress.tests ?? []
  const next = tests.some((t) => t.id === test.id) ? tests.map((t) => (t.id === test.id ? test : t)) : [...tests, test]
  return { ...progress, tests: next, updatedAt: now }
}

export function finishDueTest(progress: Progress, now: number): Progress {
  const open = unfinishedTest(progress)
  return open && isDue(open, now) ? saveTest(progress, markTest(open, now), now) : progress
}
