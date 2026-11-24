import { afterEach, describe, expect, it, vi } from 'vitest'
import { MISCONCEPTIONS } from '../ai/turnSchema'
import lessonJson from '../content/ch6.lesson.json'
import type { Lesson } from '../content/lessonSchema'
import type { MistakeCode } from '../maths/types'
import { mistakeText } from './mistakeText'
import { parentSummary, SUMMARY_TIMEOUT_MS, summaryPrompt, writeSummary } from './parentSummary'
import { newProfile, type Attempt, type Profile } from './progress'
import type { TestRecord } from './test'

const lesson = lessonJson as Lesson

function wrong(code: MistakeCode): Attempt {
  return { ideaId: 'idea-1', templateId: 'perim_rectangle', difficulty: 'medium', seed: 1, answerText: 'secret 7', unit: 'cm', correct: false, reason: 'wrong_number', code, at: 1 }
}

function test(id: string, correct: number, finishedAt: number | null): TestRecord {
  const results = Array.from({ length: 10 }, (_, i) => ({ correct: i < correct, reason: null, code: null }))
  return { id, startedAt: 0, finishedAt, timeLimitS: 1200, questions: results.map(() => ({ templateId: 'perim_rectangle', difficulty: 'medium', seed: 1, ideaId: 'idea-1' })), answers: results.map(() => null), results }
}

function profile(codes: MistakeCode[], tests: TestRecord[] = [], passed: string[] = []): Profile {
  const p = newProfile('Zanzibar', 'zanzibar', lesson, 0)
  return { ...p, progress: { ...p.progress, attempts: codes.map(wrong), tests, passedIdeaIds: passed } }
}

afterEach(() => vi.useRealTimers())

describe('mistakeText', () => {
  it('has a plain-language line for every mistake code', () => {
    expect(Object.keys(mistakeText).sort()).toEqual([...MISCONCEPTIONS].sort())
    for (const code of MISCONCEPTIONS) expect(mistakeText[code].length).toBeGreaterThan(10)
    expect(mistakeText.perim_two_sides_only).toBe('Adds only two sides when finding perimeter')
  })
})

describe('parentSummary', () => {
  it('lists the top 3 codes by count, then by lesson order, with ideas passed and finished scores newest first', () => {
    const s = parentSummary(
      profile(
        ['units_missing', 'rectilinear_missed_edge', 'rectilinear_missed_edge', 'perim_area_confused', 'perim_two_sides_only'],
        [test('a', 4, 10), test('b', 7, 30), test('open', 9, null), test('c', 5, 20), test('d', 6, 5)],
        ['idea-1', 'idea-2', 'not-in-lesson'],
      ),
      lesson,
    )
    expect(s.passed).toBe(2)
    expect(s.total).toBe(lesson.ideas.length)
    expect(s.mistakes.map((m) => [m.code, m.count])).toEqual([
      ['rectilinear_missed_edge', 2],
      ['perim_two_sides_only', 1],
      ['perim_area_confused', 1],
    ])
    expect(s.mistakes[1].text).toBe('Adds only two sides when finding perimeter')
    expect(s.scores).toEqual([
      { correct: 7, outOf: 10 },
      { correct: 5, outOf: 10 },
      { correct: 4, outOf: 10 },
    ])
  })

  it('is empty for a new learner', () => {
    expect(parentSummary(profile([]), lesson)).toMatchObject({ passed: 0, mistakes: [], scores: [] })
  })
})

describe('summaryPrompt', () => {
  it('holds only the mistake lines, counts and scores, never the nickname or typed text', () => {
    const p = profile(['units_missing', 'units_missing'], [test('a', 6, 1)])
    const prompt = summaryPrompt(parentSummary(p, lesson))
    expect(prompt).toContain('- Forgets to write the units: 2')
    expect(prompt).toContain('6 out of 10')
    expect(prompt).toContain('under 80 words')
    expect(prompt).toContain(lesson.title)
    expect(prompt).not.toMatch(/Zanzibar|secret|units_missing/)
  })
})

describe('writeSummary', () => {
  const data = { title: lesson.title, mistakes: [{ code: 'units_missing' as const, text: mistakeText.units_missing, count: 2 }], scores: [] }
  const model = (reply: Promise<string>) => ({ generateContent: () => reply.then((t) => ({ response: { text: () => t } })) })

  it('returns the trimmed paragraph', async () => {
    expect(await writeSummary(model(Promise.resolve('  Your child forgets units.  ')), data)).toBe('Your child forgets units.')
  })

  it.each(['', '   ', 'x'.repeat(401)])('rejects %j', async (reply) => {
    expect(await writeSummary(model(Promise.resolve(reply)), data)).toBeNull()
  })

  it('accepts exactly 400 characters and rejects a failed call', async () => {
    expect(await writeSummary(model(Promise.resolve('x'.repeat(400))), data)).toHaveLength(400)
    expect(await writeSummary(model(Promise.reject(new Error('no'))), data)).toBeNull()
  })

  it('times out after 10 seconds', async () => {
    vi.useFakeTimers()
    const pending = writeSummary(model(new Promise(() => {})), data)
    await vi.advanceTimersByTimeAsync(SUMMARY_TIMEOUT_MS)
    expect(await pending).toBeNull()
  })
})
