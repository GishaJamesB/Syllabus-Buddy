import { describe, expect, it } from 'vitest'
import lessonJson from '../content/ch6.lesson.json'
import type { Lesson } from '../content/lessonSchema'
import { grade } from '../maths/grade'
import {
  canGoNext,
  checkNickname,
  checkQuestion,
  finish,
  firstCheckSeed,
  freshSeed,
  goTo,
  ideaState,
  missCount,
  mistakeHistory,
  newProfile,
  newProgress,
  nextQuestion,
  passingAttempt,
  recordAttempt,
  resumeTarget,
  showSteps,
  startAgain,
  workedExample,
  type Progress,
} from './progress'

const lesson = lessonJson as Lesson
const [idea1, idea2] = lesson.ideas

function answer(progress: Progress, ideaIndex: number, text: string, unit: Parameters<typeof grade>[1]['unit']) {
  const idea = lesson.ideas[ideaIndex]
  const q = checkQuestion(idea, ideaState(progress, idea).questionSeed)
  const input = { text, unit: unit ?? null }
  return recordAttempt(progress, idea, input, grade(q, input), 1)
}

function answerRight(progress: Progress, ideaIndex: number) {
  const idea = lesson.ideas[ideaIndex]
  const q = checkQuestion(idea, ideaState(progress, idea).questionSeed)
  return answer(progress, ideaIndex, String(q.answer.value), q.answer.unit)
}

describe('checkNickname', () => {
  it('trims and collapses inner spaces', () => {
    expect(checkNickname('  Star   Girl ', [])).toEqual({ ok: true, nickname: 'Star Girl', id: 'star girl' })
  })
  it('accepts Unicode letters and numbers', () => {
    expect(checkNickname('Zoë 7', []).ok).toBe(true)
    expect(checkNickname('ΣΩ 12', []).ok).toBe(true)
  })
  it('rejects empty, too long and symbols', () => {
    expect(checkNickname('   ', []).ok).toBe(false)
    expect(checkNickname('a'.repeat(21), []).ok).toBe(false)
    expect(checkNickname('a'.repeat(20), []).ok).toBe(true)
    expect(checkNickname('riya!', []).ok).toBe(false)
    expect(checkNickname('riya@x.com', []).ok).toBe(false)
  })
  it('rejects a duplicate case-insensitively', () => {
    expect(checkNickname('riya ', ['riya'])).toEqual({ ok: false, error: 'That nickname is taken on this device' })
  })
})

describe('progress', () => {
  it('starts on the first idea with order-based seeds', () => {
    const p = newProgress(lesson, 0)
    expect(p.currentIdeaId).toBe('idea-1')
    expect(ideaState(p, idea2).questionSeed).toBe(firstCheckSeed(idea2))
    expect(firstCheckSeed(idea2)).toBeGreaterThanOrEqual(2001)
    expect(workedExample(idea2).seed).toBe(2000)
  })

  it('makes the first check answer differ from the worked answer on every idea', () => {
    const p = newProgress(lesson, 0)
    for (const idea of lesson.ideas) {
      const check = checkQuestion(idea, ideaState(p, idea).questionSeed)
      expect(check.answer.value).not.toBe(workedExample(idea).answer.value)
    }
  })

  it('blocks Next until a correct answer, then marks the idea passed', () => {
    let p = newProgress(lesson, 0)
    expect(canGoNext(p, 'idea-1')).toBe(false)
    p = answer(p, 0, '1', 'cm')
    expect(canGoNext(p, 'idea-1')).toBe(false)
    p = answerRight(p, 0)
    expect(canGoNext(p, 'idea-1')).toBe(true)
    expect(passingAttempt(p, idea1)?.correct).toBe(true)
  })

  it('counts misses on the current seed but not not_a_number', () => {
    let p = newProgress(lesson, 0)
    p = answer(p, 0, 'abc', 'cm')
    p = answer(p, 0, '', null)
    expect(missCount(p, idea1)).toBe(0)
    p = answer(p, 0, '1', 'cm')
    p = answer(p, 0, '2', 'cm')
    expect(missCount(p, idea1)).toBe(2)
    p = nextQuestion(p, idea1, 2)
    expect(missCount(p, idea1)).toBe(0)
  })

  it('shows steps then moves to a fresh question with a different answer', () => {
    let p = newProgress(lesson, 0)
    p = showSteps(p, idea1, 1)
    expect(ideaState(p, idea1).stepsShown).toBe(true)
    const before = checkQuestion(idea1, ideaState(p, idea1).questionSeed).answer.value
    p = nextQuestion(p, idea1, 2)
    const state = ideaState(p, idea1)
    expect(state.stepsShown).toBe(false)
    const after = checkQuestion(idea1, state.questionSeed).answer.value
    expect(after).not.toBe(before)
    expect(after).not.toBe(workedExample(idea1).answer.value)
  })

  it('freshSeed skips seeds with the same answer value', () => {
    for (const idea of lesson.ideas) {
      const s = freshSeed(idea, idea.order * 1000 + 1)
      expect(checkQuestion(idea, s).answer.value).not.toBe(checkQuestion(idea, idea.order * 1000 + 1).answer.value)
    }
  })

  it('resumes on the saved idea, then the first unpassed, then complete', () => {
    let p = newProgress(lesson, 0)
    p = goTo(p, 'idea-4', 1)
    expect(resumeTarget(lesson, p)).toMatchObject({ kind: 'idea', index: 3 })
    p = { ...goTo(p, 'gone', 1), passedIdeaIds: ['idea-1', 'unknown'] }
    expect(resumeTarget(lesson, p)).toMatchObject({ kind: 'idea', index: 1 })
    p = { ...p, passedIdeaIds: [...lesson.ideas.map((i) => i.id), 'unknown'] }
    expect(resumeTarget(lesson, p)).toEqual({ kind: 'complete' })
    expect(resumeTarget(lesson, finish(p, 2))).toEqual({ kind: 'complete' })
  })

  it('start again clears passes and seeds but keeps attempts, and old misses no longer count', () => {
    let p = newProgress(lesson, 0)
    p = answer(p, 0, '1', 'cm')
    p = answer(p, 0, '2', 'cm')
    p = answerRight(p, 0)
    p = startAgain(p, lesson, 3)
    expect(p.passedIdeaIds).toEqual([])
    expect(p.ideas).toEqual({})
    expect(p.currentIdeaId).toBe('idea-1')
    expect(p.attempts).toHaveLength(3)
    expect(missCount(p, idea1)).toBe(0)
  })

  it('mistakeHistory counts per mistake code', () => {
    const q = checkQuestion(idea1, ideaState(newProgress(lesson, 0), idea1).questionSeed)
    const twoSides = q.mistakes.find((m) => m.code === 'perim_two_sides_only')!
    let p = newProgress(lesson, 0)
    p = answer(p, 0, String(twoSides.value), 'cm')
    p = answer(p, 0, String(twoSides.value), 'cm')
    p = answer(p, 0, String(q.answer.value), null)
    const profile = { ...newProfile('Riya', 'riya', lesson, 0), progress: p }
    expect(mistakeHistory(profile)).toEqual({ perim_two_sides_only: 2, units_missing: 1 })
  })
})
