import { describe, expect, it } from 'vitest'
import lessonJson from '../content/ch6.lesson.json'
import type { Lesson, LessonDifficulty } from '../content/lessonSchema'
import { createRng } from '../maths/rng'
import { mistakeHistory, newProfile, newProgress, type Attempt, type Progress } from './progress'
import {
  answerTest,
  BLANK_RESULT,
  buildTest,
  finishDueTest,
  finishedTests,
  isDue,
  lessonTemplates,
  markTest,
  newTest,
  nextUnanswered,
  remainingMs,
  saveTest,
  score,
  TEST_SEED_MIN,
  testQuestion,
  testTimer,
  timeLimitFor,
  unfinishedTest,
  weakTemplates,
  type TestRecord,
} from './test'

const lesson = lessonJson as Lesson

const seeded = (seed: number) => {
  const rng = createRng(seed)
  return () => rng.int(0, 999_999_999) / 1_000_000_000
}

function miss(templateId: string, difficulty: LessonDifficulty = 'medium', at = 1, reason: Attempt['reason'] = 'wrong_number'): Attempt {
  return { ideaId: 'idea-1', templateId, difficulty, seed: 1, answerText: '1', unit: 'cm', correct: false, reason, code: null, at }
}

function hit(templateId: string, at = 1): Attempt {
  return { ...miss(templateId, 'medium', at), correct: true, reason: null }
}

const withAttempts = (attempts: Attempt[]): Progress => ({ ...newProgress(lesson, 0), attempts })

function rightInput(test: TestRecord, i: number) {
  const q = testQuestion(test.questions[i])
  return { text: String(q.answer.value), unit: q.answer.unit }
}

describe('lessonTemplates', () => {
  it('lists check then practice templates in lesson order, each once, with check difficulty and idea', () => {
    const list = lessonTemplates(lesson)
    expect(list.map((t) => t.templateId)).toEqual([
      'perim_rectangle',
      'perim_square',
      'perim_regular_polygon',
      'perim_triangle',
      'perim_missing_side_rectangle',
      'perim_missing_side_square',
      'perim_fencing_cost',
      'area_square',
      'area_rectangle',
      'area_missing_side_rectangle',
      'area_l_shape',
      'area_uncovered',
      'area_triangle_half_rectangle',
    ])
    expect(list.find((t) => t.templateId === 'perim_triangle')).toEqual({ templateId: 'perim_triangle', difficulty: 'medium', ideaId: 'idea-3' })
  })
})

describe('weakTemplates', () => {
  it('ignores right answers and not-a-number attempts', () => {
    const p = withAttempts([hit('perim_square'), miss('area_square', 'medium', 1, 'not_a_number')])
    expect(weakTemplates(lesson, p)).toEqual([])
  })

  it('uses the difficulty of the most recent miss', () => {
    const p = withAttempts([miss('perim_square', 'easy', 1), miss('perim_square', 'hard', 2)])
    expect(weakTemplates(lesson, p)).toEqual([{ templateId: 'perim_square', difficulty: 'hard' }])
  })

  it('counts only the most recent 20 attempts', () => {
    const p = withAttempts([miss('perim_square'), ...Array.from({ length: 20 }, () => hit('perim_rectangle'))])
    expect(weakTemplates(lesson, p)).toEqual([])
  })

  it('counts tutor misses, parsing the difficulty from the question id', () => {
    const p: Progress = {
      ...newProgress(lesson, 0),
      tutorSessions: [
        {
          ideaId: 'idea-6',
          startedAt: 5,
          seed: 1,
          calls: [],
          results: [{ questionId: 'area_l_shape:hard:7', templateId: 'area_l_shape', correct: false, code: null }],
          outcome: 'mastered',
        },
      ],
    }
    expect(weakTemplates(lesson, p)).toEqual([{ templateId: 'area_l_shape', difficulty: 'hard' }])
  })

  it('counts blanks in finished tests but not unfinished tests', () => {
    const questions = buildTest(lesson, newProgress(lesson, 0), seeded(1))
    const open = newTest(questions, 0)
    const p = saveTest(newProgress(lesson, 0), open, 0)
    expect(weakTemplates(lesson, p)).toEqual([])
    const done = markTest(open, 10)
    const weak = weakTemplates(lesson, saveTest(p, done, 10)).map((w) => w.templateId)
    expect(new Set(weak)).toEqual(new Set(questions.map((q) => q.templateId)))
  })
})

describe('buildTest', () => {
  it('spreads 10 questions across the templates when there are no mistakes', () => {
    const questions = buildTest(lesson, newProgress(lesson, 0), seeded(1))
    expect(questions).toHaveLength(10)
    expect(new Set(questions.map((q) => q.templateId)).size).toBe(10)
    expect(questions.every((q) => q.difficulty === 'medium')).toBe(true)
    expect(questions.find((q) => q.templateId === 'perim_triangle')?.ideaId).toBe('idea-3')
  })

  it('covers every lesson template across 50 tests with no mistakes', () => {
    const seen = new Set<string>()
    for (let s = 1; s <= 50; s++) for (const q of buildTest(lesson, newProgress(lesson, 0), seeded(s))) seen.add(q.templateId)
    expect(seen).toEqual(new Set(lessonTemplates(lesson).map((t) => t.templateId)))
  })

  it('gives weak templates at least 4 of 10 questions in every test, with both present', () => {
    const p = withAttempts([miss('area_l_shape', 'hard'), miss('perim_square', 'easy')])
    for (let s = 1; s <= 100; s++) {
      const questions = buildTest(lesson, p, seeded(s))
      const weak = questions.filter((q) => q.templateId === 'area_l_shape' || q.templateId === 'perim_square')
      expect(weak.length).toBeGreaterThanOrEqual(4)
      expect(weak.filter((q) => q.templateId === 'area_l_shape').length).toBeGreaterThanOrEqual(1)
      expect(weak.filter((q) => q.templateId === 'perim_square').length).toBeGreaterThanOrEqual(1)
      expect(weak.filter((q) => q.templateId === 'area_l_shape').every((q) => q.difficulty === 'hard')).toBe(true)
      expect(weak.filter((q) => q.templateId === 'perim_square').every((q) => q.difficulty === 'easy')).toBe(true)
    }
  })

  it('uses each weak template once before repeating when there are more than 4', () => {
    const weakIds = ['perim_rectangle', 'perim_square', 'area_square', 'area_l_shape', 'area_uncovered']
    const questions = buildTest(lesson, withAttempts(weakIds.map((t) => miss(t))), seeded(3))
    for (const id of weakIds) expect(questions.filter((q) => q.templateId === id)).toHaveLength(1)
  })

  it('never repeats a template and answer value in one test', () => {
    const p = withAttempts([miss('perim_square'), miss('area_square')])
    for (let s = 1; s <= 50; s++) {
      const keys = buildTest(lesson, p, seeded(s)).map((ref) => `${ref.templateId}:${testQuestion(ref).answer.value}`)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('uses fresh seeds above the lesson seeds each time', () => {
    const p = newProgress(lesson, 0)
    const a = buildTest(lesson, p, seeded(1))
    const b = buildTest(lesson, p, seeded(2))
    expect([...a, ...b].every((q) => q.seed >= TEST_SEED_MIN)).toBe(true)
    expect(a.map((q) => q.seed)).not.toEqual(b.map((q) => q.seed))
    const numbers = (qs: typeof a) => qs.map((q) => testQuestion(q).prompt).sort()
    expect(numbers(a)).not.toEqual(numbers(b))
  })

  it('is pure given the random source', () => {
    const p = withAttempts([miss('perim_square')])
    expect(buildTest(lesson, p, seeded(9))).toEqual(buildTest(lesson, p, seeded(9)))
  })
})

describe('timer', () => {
  it('sums the time per difficulty', () => {
    const qs = buildTest(lesson, newProgress(lesson, 0), seeded(1))
    expect(timeLimitFor(qs)).toBe(10 * testTimer.medium)
    expect(timeLimitFor([{ ...qs[0], difficulty: 'easy' }, { ...qs[1], difficulty: 'hard' }])).toBe(90 + 150)
  })

  it('gives each new test a distinct id even at the same moment', () => {
    const qs = buildTest(lesson, newProgress(lesson, 0), seeded(1))
    expect(newTest(qs, 5).id).not.toBe(newTest(qs, 5).id)
  })

  it('measures remaining time from startedAt', () => {
    const t = newTest(buildTest(lesson, newProgress(lesson, 0), seeded(1)), 1000)
    expect(remainingMs(t, 1000)).toBe(1200_000)
    expect(remainingMs(t, 61_000)).toBe(1140_000)
    expect(isDue(t, 1000 + 1200_000)).toBe(true)
  })
})

describe('marking', () => {
  const start = () => newTest(buildTest(lesson, newProgress(lesson, 0), seeded(4)), 0)

  it('grades each answer, records blanks, and fills the rest with blanks at the end', () => {
    let t = start()
    t = answerTest(t, 0, rightInput(t, 0), 1)
    t = answerTest(t, 1, { text: '1', unit: 'cm' }, 1)
    t = answerTest(t, 2, null, 1)
    expect(nextUnanswered(t)).toBe(3)
    expect(t.results[0]).toEqual({ correct: true, reason: null, code: null })
    expect(t.results[1]?.correct).toBe(false)
    expect(t.answers[2]).toBeNull()
    expect(t.results[2]).toEqual(BLANK_RESULT)
    expect(answerTest(t, 0, { text: '1', unit: 'cm' }, 1)).toBe(t)
    expect(answerTest(t, 3, rightInput(t, 3), t.timeLimitS * 1000)).toBe(t)

    const done = markTest(t, 50)
    expect(done.finishedAt).toBe(50)
    expect(done.results.slice(3).every((r) => r?.reason === 'blank')).toBe(true)
    expect(score(done)).toBe(1)
  })

  it('finishes a test once every question is answered', () => {
    let t = start()
    for (let i = 0; i < 10; i++) t = answerTest(t, i, rightInput(t, i), 1)
    expect(isDue(t, 1)).toBe(true)
    const p = finishDueTest(saveTest(newProgress(lesson, 0), t, 1), 2)
    expect(unfinishedTest(p)).toBeNull()
    expect(score(finishedTests(p)[0])).toBe(10)
  })

  it('lists finished tests newest first, up to 5', () => {
    let p = newProgress(lesson, 0)
    for (let i = 0; i < 7; i++) p = saveTest(p, { ...markTest(start(), i), id: `t${i}` }, i)
    p = saveTest(p, { ...start(), id: 'open' }, 9)
    expect(finishedTests(p).map((t) => t.id)).toEqual(['t6', 't5', 't4', 't3', 't2'])
    expect(unfinishedTest(p)?.id).toBe('open')
  })

  it('counts wrong test answers in the mistake history, but not blanks', () => {
    let t = start()
    const i = t.questions.findIndex((q) => testQuestion(q).mistakes.length > 0)
    const known = testQuestion(t.questions[i]).mistakes[0]
    t = answerTest(t, i, { text: String(known.value), unit: 'cm' }, 1)
    const profile = newProfile('Riya', 'riya', lesson, 0)
    profile.progress = saveTest(profile.progress, t, 1)
    expect(mistakeHistory(profile)).toEqual({})
    profile.progress = saveTest(profile.progress, markTest(t, 1), 1)
    expect(mistakeHistory(profile)).toEqual({ [known.code]: 1 })
  })
})
