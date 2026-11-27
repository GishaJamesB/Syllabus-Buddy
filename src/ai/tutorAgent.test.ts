import type { Content } from 'firebase/ai'
import { describe, expect, it } from 'vitest'
import lessonJson from '../content/ch6.lesson.json'
import type { Idea, Lesson } from '../content/lessonSchema'
import { checkQuestion, firstCheckSeed } from '../learner/progress'
import { generate } from '../maths/registry'
import { formatAnswer, type GradeResult, type Question, type Unit } from '../maths/types'
import {
  buildSummary,
  NUDGE,
  SYSTEM_INSTRUCTION,
  TUTOR_MAX_TURNS,
  TutorSession,
  tutorTools,
  type TutorRecord,
  type TutorModel,
  type TutorView,
} from './tutorAgent'

const lesson = lessonJson as Lesson
const idea1 = lesson.ideas[0]
const idea3 = lesson.ideas[2]

type Call = { name: string; args?: Record<string, unknown> }
type Step = { calls?: Call[]; text?: string } | Error

// Like the SDK's ChatSession, a rejected send poisons the chat: every later send on it rejects too.
function fakeModel(script: Step[]) {
  const requests: unknown[] = []
  const system: string[] = []
  const histories: Content[][] = []
  const model: TutorModel = {
    startChat({ systemInstruction, history = [] }) {
      system.push(systemInstruction)
      histories.push(history)
      let chatHistory = [...history]
      let sendPromise: Promise<void> = Promise.resolve()
      return {
        async sendMessage(request) {
          await sendPromise
          let response!: { text: () => string; functionCalls: () => { name: string; args: Record<string, unknown> }[] | undefined }
          sendPromise = sendPromise.then(async () => {
            requests.push(structuredClone(request))
            const step = script.shift() ?? {}
            if (step instanceof Error) throw step
            response = {
              text: () => step.text ?? '',
              functionCalls: () => step.calls?.map((c) => ({ name: c.name, args: c.args ?? {} })),
            }
          })
          await sendPromise
          chatHistory = [...chatHistory, { role: 'user', parts: [] }, { role: 'model', parts: [] }]
          return { response }
        },
        async getHistory() {
          return chatHistory
        },
      }
    },
  }
  return { model, requests, system, histories }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const SEED = 4242

function run(idea: Idea, script: Step[], options: { hasPrevious?: boolean; passed?: boolean; newSeed?: () => number } = {}) {
  const fake = fakeModel(script)
  const check = checkQuestion(idea, firstCheckSeed(idea))
  const views: TutorView[] = []
  const records: TutorRecord[] = []
  const mastered: { question: Question; result: GradeResult }[] = []
  const navigated: string[] = []
  let seed = SEED
  const session = new TutorSession({
    model: fake.model,
    idea,
    checkQuestion: check,
    summary: buildSummary({ idea, misses: 3, mistakeCodes: ['perim_two_sides_only'], history: { perim_two_sides_only: 2 } }),
    hasPrevious: options.hasPrevious ?? true,
    isPassed: () => options.passed ?? false,
    onChange: (v) => views.push(v),
    onRecord: (r) => records.push(r),
    onMastered: (question, _input, result) => mastered.push({ question, result }),
    onNavigate: (d) => navigated.push(d),
    newSeed: options.newSeed ?? (() => seed++),
    sleep: () => Promise.resolve(),
  })
  return { session, fake, check, views, records, mastered, navigated }
}

const practiceOf = (templateId: string, difficulty: 'easy' | 'medium' | 'hard', seed = SEED) => generate(templateId, difficulty, seed)

function responses(request: unknown) {
  return (request as { functionResponse: { name: string; response: Record<string, unknown> } }[]).map((p) => p.functionResponse)
}

const right = (q: Question): { text: string; unit: Unit | null } => ({ text: String(q.answer.value), unit: q.answer.unit })

describe('tutor summary and tools', () => {
  it('builds the anonymised summary and limits makePractice to the idea templates', () => {
    const summary = buildSummary({ idea: idea3, misses: 3, mistakeCodes: ['perim_two_sides_only'], history: { units_missing: 1 } })
    expect(summary).toEqual({
      idea: { title: idea3.title, keyPoints: idea3.keyPoints },
      templateId: 'perim_regular_polygon',
      difficulty: 'medium',
      misses: 3,
      mistakeCodes: ['perim_two_sides_only'],
      history: { units_missing: 1 },
      maxTurns: TUTOR_MAX_TURNS,
    })
    const make = tutorTools(idea3).find((t) => t.name === 'makePractice')!
    expect((make.parameters as unknown as { properties: { templateId: { enum: string[] } } }).properties.templateId.enum).toEqual([
      'perim_regular_polygon',
      'perim_triangle',
    ])
    expect(tutorTools(idea3).map((t) => t.name)).toEqual([
      'getMistakeHistory',
      'makePractice',
      'showDiagram',
      'giveWorkedSolution',
      'navigate',
    ])
  })
})

describe('TutorSession', () => {
  it('runs the scripted success: history, practice, diagram, then a correct answer masters the idea', async () => {
    const t = run(idea1, [
      { calls: [{ name: 'getMistakeHistory' }] },
      {
        calls: [
          { name: 'makePractice', args: { templateId: 'perim_rectangle', difficulty: 'medium' } },
          { name: 'showDiagram', args: { questionId: 'p1' } },
        ],
        text: 'Add every side!',
      },
    ])
    await t.session.start()
    expect(t.fake.system).toEqual([SYSTEM_INSTRUCTION])
    expect(t.fake.requests[0]).toBe(t.session.summaryText)
    expect(responses(t.fake.requests[1])).toEqual([{ name: 'getMistakeHistory', response: { perim_two_sides_only: 2 } }])

    const practice = practiceOf('perim_rectangle', 'medium')
    const view = t.session.current
    expect(view.phase).toBe('answering')
    expect(view.awaiting).toEqual(practice)
    expect(view.items.map((i) => i.kind)).toEqual(['practice', 'diagram', 'say'])

    const result = t.session.answer(right(practice))
    expect(result?.correct).toBe(true)
    await flush()
    expect(t.fake.requests).toHaveLength(2)
    expect(t.mastered.map((m) => m.question)).toEqual([practice])
    expect(t.session.current.outcome).toBe('mastered')
    expect(t.session.current.log.map((e) => (e.kind === 'call' ? e.name : e.kind))).toEqual([
      'summary',
      'getMistakeHistory',
      'makePractice',
      'showDiagram',
      'result',
      'end',
    ])
    expect(t.records.at(-1)).toEqual({
      calls: [
        { name: 'getMistakeHistory', args: {}, by: 'model' },
        { name: 'makePractice', args: { templateId: 'perim_rectangle', difficulty: 'medium' }, by: 'model' },
        { name: 'showDiagram', args: { questionId: 'p1' }, by: 'model' },
      ],
      results: [{ questionId: 'p1', templateId: 'perim_rectangle', correct: true, code: null }],
      outcome: 'mastered',
    })
  })

  it('sends only correct, reason and code with the practice handle, and keeps going after a non-check template', async () => {
    const t = run(idea3, [
      { calls: [{ name: 'makePractice', args: { templateId: 'perim_triangle', difficulty: 'easy' } }] },
      { calls: [{ name: 'giveWorkedSolution', args: { questionId: 'p1' } }] },
    ])
    await t.session.start()
    const practice = practiceOf('perim_triangle', 'easy')
    expect(t.session.answer({ text: 'lots', unit: null })?.reason).toBe('not_a_number')
    expect(t.fake.requests).toHaveLength(1)
    t.session.answer(right(practice))
    await flush()
    expect(t.mastered).toEqual([])
    expect(responses(t.fake.requests[1])).toEqual([
      {
        name: 'makePractice',
        response: { questionId: 'p1', prompt: practice.prompt, correct: true, reason: null, code: null },
      },
    ])
    expect(t.session.current.items.map((i) => i.kind).slice(0, 2)).toEqual(['practice', 'steps'])
    expect(responses(t.fake.requests[2])).toEqual([{ name: 'giveWorkedSolution', response: { shown: true } }])
    expect(t.fake.requests[3]).toBe(NUDGE)
  })

  it('returns an error to the model for an unrelated template and shows the child nothing', async () => {
    const t = run(idea1, [{ calls: [{ name: 'makePractice', args: { templateId: 'area_square', difficulty: 'easy' } }] }, { calls: [{ name: 'showDiagram', args: { questionId: 'p9' } }] }])
    await t.session.start()
    expect(responses(t.fake.requests[1])[0].response).toMatchObject({ error: expect.any(String), allowed: ['perim_rectangle'] })
    expect(responses(t.fake.requests[2])[0].response).toMatchObject({ error: expect.any(String) })
    expect(t.session.current.items).toEqual([{ kind: 'steps', question: t.check }])
    expect(t.session.current.outcome).toBe('out_of_turns')
  })

  it('explains the stuck question with questionId "check" before any practice', async () => {
    const t = run(idea1, [
      {
        calls: [
          { name: 'showDiagram', args: { questionId: 'check' } },
          { name: 'giveWorkedSolution', args: { questionId: 'check' } },
        ],
        text: "Let's look at this one together.",
      },
    ])
    await t.session.start()
    expect(responses(t.fake.requests[1])).toEqual([
      { name: 'showDiagram', response: { shown: true } },
      { name: 'giveWorkedSolution', response: { shown: true } },
    ])
    expect(t.session.current.items.slice(0, 3)).toEqual([
      { kind: 'diagram', question: t.check },
      { kind: 'steps', question: t.check },
      { kind: 'say', text: "Let's look at this one together." },
    ])
  })

  it('never repeats the answer of an earlier practice question of the same kind', async () => {
    const make = { name: 'makePractice', args: { templateId: 'perim_rectangle', difficulty: 'easy' } }
    let calls = 0
    const t = run(idea1, [{ calls: [make] }, { calls: [make] }], { newSeed: () => (calls++ < 2 ? SEED : SEED + calls) })
    await t.session.start()
    const first = t.session.current.awaiting as Question
    expect(first.answer.value).toBe(practiceOf('perim_rectangle', 'easy').answer.value)
    t.session.answer({ text: '1', unit: 'cm' })
    await new Promise((r) => setTimeout(r, 0))
    const second = t.session.current.awaiting as Question
    expect(second).not.toBe(first)
    expect(second.answer.value).not.toBe(first.answer.value)
  })

  it('tells the model to explain before testing', () => {
    expect(SYSTEM_INSTRUCTION).toContain('Explain before you test.')
    expect(SYSTEM_INSTRUCTION).toContain('questionId "check"')
  })

  it('refuses navigate next before the idea is passed, allows stay, and ends on back', async () => {
    const t = run(idea1, [
      { calls: [{ name: 'navigate', args: { direction: 'next' } }, { name: 'navigate', args: { direction: 'stay' } }] },
      { calls: [{ name: 'navigate', args: { direction: 'back' } }] },
    ])
    await t.session.start()
    expect(responses(t.fake.requests[1]).map((r) => r.response)).toEqual([
      { error: expect.stringContaining('not passed') },
      { ok: true },
    ])
    expect(t.navigated).toEqual(['back'])
    expect(t.session.current.outcome).toBe('navigated')
    expect(t.fake.requests).toHaveLength(2)
    expect(t.records.at(-1)?.outcome).toBe('navigated')
  })

  it('allows navigate next once passed and refuses back on the first idea', async () => {
    const t = run(idea1, [{ calls: [{ name: 'navigate', args: { direction: 'back' } }] }, { calls: [{ name: 'navigate', args: { direction: 'next' } }] }], {
      hasPrevious: false,
      passed: true,
    })
    await t.session.start()
    expect(responses(t.fake.requests[1])[0].response).toEqual({ error: 'There is no previous idea.' })
    expect(t.navigated).toEqual(['next'])
  })

  it('ends out of turns with the worked steps of the check question when no practice was made', async () => {
    const t = run(idea1, Array.from({ length: 10 }, () => ({ calls: [{ name: 'getMistakeHistory' }] })))
    await t.session.start()
    expect(t.fake.requests).toHaveLength(TUTOR_MAX_TURNS)
    expect(t.session.current.outcome).toBe('out_of_turns')
    expect(t.session.current.items).toEqual([{ kind: 'steps', question: t.check }])
    expect(t.records.at(-1)?.calls.at(-1)).toEqual({ name: 'giveWorkedSolution', args: { questionId: 'check' }, by: 'app' })
  })

  it('ends out of turns on the last practice question after wrong answers', async () => {
    const make = { calls: [{ name: 'makePractice', args: { templateId: 'perim_rectangle', difficulty: 'easy' } }] }
    const t = run(idea1, Array.from({ length: 5 }, () => make))
    await t.session.start()
    let last: Question | null = null
    for (let i = 0; i < TUTOR_MAX_TURNS; i++) {
      last = t.session.current.awaiting
      t.session.answer({ text: '999999', unit: 'cm' })
      await flush()
    }
    expect(t.fake.requests).toHaveLength(TUTOR_MAX_TURNS)
    expect(t.session.current.items.at(-1)).toEqual({ kind: 'steps', question: last })
    expect(t.session.current.outcome).toBe('out_of_turns')
    expect(t.records.at(-1)?.calls.at(-1)).toEqual({ name: 'giveWorkedSolution', args: { questionId: 'p5' }, by: 'app' })
  })

  it('drops tutor text that contains the practice answer', async () => {
    const practice = practiceOf('perim_rectangle', 'easy')
    const t = run(idea1, [
      {
        calls: [{ name: 'makePractice', args: { templateId: 'perim_rectangle', difficulty: 'easy' } }],
        text: `The answer is ${practice.answer.value}.`,
      },
    ])
    await t.session.start()
    expect(t.session.current.items.map((i) => i.kind)).toEqual(['practice'])
  })

  it('retries when the model is busy, then fails after the last retry', async () => {
    const busy = () => new Error('[503 ] The model is overloaded. high demand')
    const ok = run(idea1, [busy(), { calls: [{ name: 'makePractice', args: { templateId: 'perim_rectangle', difficulty: 'easy' } }] }])
    await ok.session.start()
    expect(ok.views.some((v) => v.phase === 'busy')).toBe(true)
    expect(ok.session.current.phase).toBe('answering')

    const failed = run(idea1, [busy(), busy(), busy(), busy()])
    await failed.session.start()
    expect(failed.session.current.outcome).toBe('failed')
    expect(failed.records.at(-1)?.outcome).toBe('failed')
  })

  it('fails on a model error and ignores a reply that arrives after cancel', async () => {
    const t = run(idea1, [new Error('[400 ] bad')])
    await t.session.start()
    expect(t.session.current.outcome).toBe('failed')

    const late = run(idea1, [{ calls: [{ name: 'getMistakeHistory' }] }])
    const started = late.session.start()
    late.session.cancel()
    await started
    expect(late.session.current.log.map((e) => e.kind)).toEqual(['summary'])
    expect(late.fake.requests).toHaveLength(1)
  })

  it('never sends typed answers or any answer key in a request', async () => {
    const make = (templateId: string) => ({ calls: [{ name: 'makePractice', args: { templateId, difficulty: 'medium' } }] })
    const t = run(idea3, [make('perim_triangle'), make('perim_regular_polygon'), make('perim_regular_polygon')])
    await t.session.start()
    const asked: Question[] = []
    const answer = async (input?: { text: string; unit: Unit | null }) => {
      const q = t.session.current.awaiting!
      asked.push(q)
      t.session.answer(input ?? right(q))
      await flush()
    }
    await answer({ text: '987654', unit: 'cm' })
    await answer({ text: '876543', unit: 'cm' })
    await answer()
    expect(t.session.current.outcome).toBe('mastered')

    const sent = JSON.stringify([t.fake.system, t.fake.requests])
    expect(sent).not.toContain('987654')
    expect(sent).not.toContain('876543')
    for (const q of [t.check, ...asked]) expect(sent).not.toContain(formatAnswer(q.answer))
    expect(sent).not.toMatch(/"answer"/)
  })
})

describe('TutorSession review fixes', () => {
  const make = (difficulty: string) => ({ name: 'makePractice', args: { templateId: 'perim_rectangle', difficulty } })

  it('refuses the worked steps of the question the child is still answering', async () => {
    const t = run(idea1, [{ calls: [make('medium'), { name: 'giveWorkedSolution', args: { questionId: 'p1' } }] }])
    await t.session.start()
    expect(t.session.current.items.map((i) => i.kind)).toEqual(['practice'])
    t.session.answer({ text: '999999', unit: 'cm' })
    await flush()
    expect(responses(t.fake.requests[1])[1].response).toEqual({ error: 'Wait for the child to answer first.' })
  })

  it('does not pass a medium idea on an easy practice, but does on a hard one', async () => {
    const easy = run(idea1, [{ calls: [make('easy')] }, { calls: [make('hard')] }])
    await easy.session.start()
    easy.session.answer(right(easy.session.current.awaiting!))
    await flush()
    expect(easy.mastered).toEqual([])
    const hard = easy.session.current.awaiting!
    expect(hard.difficulty).toBe('hard')
    easy.session.answer(right(hard))
    await flush()
    expect(easy.mastered.map((m) => m.question)).toEqual([hard])
    expect(easy.session.current.outcome).toBe('mastered')
  })

  it('records each practice result with its mistake code', async () => {
    const t = run(idea1, [{ calls: [make('easy')] }])
    await t.session.start()
    const q = t.session.current.awaiting!
    const known = q.mistakes[0]
    t.session.answer({ text: String(known.value), unit: 'cm' })
    await flush()
    expect(t.records.at(-1)?.results[0]).toEqual({ questionId: 'p1', templateId: 'perim_rectangle', correct: false, code: known.code })
  })

  it('starts a new chat with the last good history after a busy error, then succeeds', async () => {
    const busy = new Error('[503 ] high demand')
    const t = run(idea1, [{ calls: [{ name: 'getMistakeHistory' }] }, busy, { calls: [make('medium')] }])
    await t.session.start()
    expect(t.session.current.phase).toBe('answering')
    expect(t.fake.histories.map((h) => h.length)).toEqual([0, 2])
  })

  it('retries a timed-out request', async () => {
    const t = run(idea1, [new Error('Buddy timed out'), { calls: [make('medium')] }])
    await t.session.start()
    expect(t.session.current.phase).toBe('answering')
  })
})
