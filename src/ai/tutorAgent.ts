import type { Content, FunctionCall, FunctionDeclaration, FunctionResponsePart, Part } from 'firebase/ai'
import { DIFFICULTIES, type Idea, type LessonDifficulty } from '../content/lessonSchema'
import { grade } from '../maths/grade'
import { generate } from '../maths/registry'
import type { GradeResult, MistakeCode, Question, Unit } from '../maths/types'
import { isSafeClue, withTimeout } from './buddy'
import { withBusyRetry } from './retry'

export const TUTOR_MAX_TURNS = 5
export const TUTOR_TIMEOUT_MS = 30_000

export type TutorOutcome = 'mastered' | 'out_of_turns' | 'navigated' | 'failed'
export type ToolName = 'getMistakeHistory' | 'makePractice' | 'showDiagram' | 'giveWorkedSolution' | 'navigate'

export interface TutorChat {
  sendMessage(
    request: string | Part[],
  ): Promise<{ response: { text(): string; functionCalls(): FunctionCall[] | undefined } }>
  getHistory(): Promise<Content[]>
}

export interface TutorModel {
  startChat(params: { systemInstruction: string; history?: Content[] }): TutorChat
}

export interface TutorSummary {
  idea: { title: string; keyPoints: string[] }
  templateId: string
  difficulty: LessonDifficulty
  misses: number
  mistakeCodes: MistakeCode[]
  history: Partial<Record<MistakeCode, number>>
  maxTurns: number
}

export interface ToolCallRecord {
  name: string
  args: Record<string, unknown>
  by: 'model' | 'app'
}

export interface PracticeResult {
  questionId: string
  templateId: string
  correct: boolean
  code: MistakeCode | null
}

export interface TutorRecord {
  calls: ToolCallRecord[]
  results: PracticeResult[]
  outcome: TutorOutcome | null
}

export type LogEntry =
  | { kind: 'summary'; text: string }
  | { kind: 'call'; name: string; args: Record<string, unknown>; by: 'model' | 'app'; label: string; error: string | null }
  | { kind: 'result'; correct: boolean; code: MistakeCode | null }
  | { kind: 'end'; outcome: TutorOutcome }

export type CardItem =
  | { kind: 'say'; text: string }
  | { kind: 'practice'; question: Question }
  | { kind: 'diagram'; question: Question }
  | { kind: 'steps'; question: Question }

export interface TutorView {
  phase: 'thinking' | 'busy' | 'answering' | 'done'
  log: LogEntry[]
  items: CardItem[]
  awaiting: Question | null
  outcome: TutorOutcome | null
}

export const TOOL_LABELS: Record<ToolName, string> = {
  getMistakeHistory: 'Looked at past mistakes',
  makePractice: 'Made a practice question',
  showDiagram: 'Drew a diagram',
  giveWorkedSolution: 'Showed the worked steps',
  navigate: 'Moved in the lesson',
}

export const SYSTEM_INSTRUCTION = [
  'You are a kind maths tutor for a 12-year-old who is stuck on one idea about perimeter and area.',
  'Your goal is that the child masters the idea within maxTurns turns.',
  'You receive only an anonymised summary of the idea and the child\'s mistake codes.',
  'Plan your help by calling tools. The app makes every question, number, answer, diagram and worked step.',
  'Use makePractice to give the child a question; its result tells you if the child was right.',
  'The idea is mastered when the child answers a practice question made from the idea\'s own templateId correctly.',
  'You may also write one short, friendly sentence for the child. Never write numbers or answers.',
].join('\n')

export const NUDGE = 'Continue helping the child by choosing a tool.'

export function tutorTools(idea: Idea): FunctionDeclaration[] {
  const templates = [...new Set([idea.checkQuestion.templateId, ...idea.practiceTemplates])]
  return [
    { name: 'getMistakeHistory', description: 'Returns the counts of mistake codes this child has made on this device.' },
    {
      name: 'makePractice',
      description:
        'Makes a practice question with new numbers and shows it to the child. The result says whether the child answered it correctly.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', enum: templates, description: "The idea's templateId or one of its practice templates." },
          difficulty: { type: 'string', enum: [...DIFFICULTIES] },
        },
        required: ['templateId', 'difficulty'],
      },
    },
    {
      name: 'showDiagram',
      description: 'Shows the labelled diagram of a practice question made in this session.',
      parameters: { type: 'object', properties: { questionId: { type: 'string' } }, required: ['questionId'] },
    },
    {
      name: 'giveWorkedSolution',
      description: 'Shows the step-by-step working of a practice question made in this session.',
      parameters: { type: 'object', properties: { questionId: { type: 'string' } }, required: ['questionId'] },
    },
    {
      name: 'navigate',
      description: 'back goes to the previous idea and ends the session. next is only allowed once the idea is passed. stay does nothing.',
      parameters: {
        type: 'object',
        properties: { direction: { type: 'string', enum: ['back', 'stay', 'next'] } },
        required: ['direction'],
      },
    },
  ]
}

export function buildSummary(input: {
  idea: Idea
  misses: number
  mistakeCodes: MistakeCode[]
  history: Partial<Record<MistakeCode, number>>
  maxTurns?: number
}): TutorSummary {
  const { idea } = input
  return {
    idea: { title: idea.title, keyPoints: [...idea.keyPoints] },
    templateId: idea.checkQuestion.templateId,
    difficulty: idea.checkQuestion.difficulty,
    misses: input.misses,
    mistakeCodes: [...input.mistakeCodes],
    history: { ...input.history },
    maxTurns: input.maxTurns ?? TUTOR_MAX_TURNS,
  }
}

export interface TutorOptions {
  model: TutorModel
  idea: Idea
  checkQuestion: Question
  summary: TutorSummary
  hasPrevious: boolean
  isPassed: () => boolean
  onChange: (view: TutorView) => void
  onRecord: (record: TutorRecord) => void
  onMastered: (question: Question, input: { text: string; unit: Unit | null }, result: GradeResult) => void
  onNavigate: (direction: 'back' | 'next') => void
  newSeed?: () => number
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const randomSeed = () => Math.floor(Math.random() * 1_000_000_000)

const rank = (d: LessonDifficulty) => DIFFICULTIES.indexOf(d)

export class TutorSession {
  readonly summaryText: string
  private chat: TutorChat | null = null
  private turns = 0
  private ended = false
  private practice = new Map<string, Question>()
  private lastPractice: Question | null = null
  private pending: { replies: FunctionResponsePart[]; index: number } | null = null
  private calls: ToolCallRecord[] = []
  private results: PracticeResult[] = []
  private history: Content[] = []
  private view: TutorView
  private readonly maxTurns: number

  constructor(private readonly opts: TutorOptions) {
    this.summaryText = JSON.stringify(opts.summary, null, 2)
    this.maxTurns = opts.summary.maxTurns
    this.view = { phase: 'thinking', log: [{ kind: 'summary', text: this.summaryText }], items: [], awaiting: null, outcome: null }
  }

  get current(): TutorView {
    return this.view
  }

  start(): Promise<void> {
    this.chat = this.opts.model.startChat({ systemInstruction: SYSTEM_INSTRUCTION })
    this.record(null)
    return this.request(this.summaryText)
  }

  cancel(): void {
    this.ended = true
  }

  fail(): void {
    if (this.ended) return
    this.finish('failed')
  }

  answer(input: { text: string; unit: Unit | null }): GradeResult | null {
    const question = this.view.awaiting
    if (this.ended || !question || !this.pending) return null
    const result = grade(question, input)
    if (result.reason === 'not_a_number') return result
    const { replies, index } = this.pending
    this.pending = null
    replies[index] = {
      type: 'functionResponse',
      functionResponse: {
        ...replies[index].functionResponse,
        response: { questionId: this.idOf(question), prompt: question.prompt, correct: result.correct, reason: result.reason ?? null, code: result.code },
      },
    }
    this.results = [
      ...this.results,
      { questionId: this.idOf(question), templateId: question.templateId, correct: result.correct, code: result.code },
    ]
    this.update({ awaiting: null, log: [...this.view.log, { kind: 'result', correct: result.correct, code: result.code }] })
    this.record(null)
    const { checkQuestion } = this.opts.idea
    const mastered =
      result.correct && question.templateId === checkQuestion.templateId && rank(question.difficulty) >= rank(checkQuestion.difficulty)
    if (mastered) {
      this.opts.onMastered(question, input, result)
      this.finish('mastered')
      return result
    }
    void this.request(replies)
    return result
  }

  private update(changes: Partial<TutorView>) {
    this.view = { ...this.view, ...changes }
    this.opts.onChange(this.view)
  }

  private finish(outcome: TutorOutcome) {
    this.ended = true
    this.pending = null
    this.update({ phase: 'done', outcome, awaiting: null, log: [...this.view.log, { kind: 'end', outcome }] })
    this.record(outcome)
  }

  private record(outcome: TutorOutcome | null) {
    this.opts.onRecord({ calls: this.calls, results: this.results, outcome })
  }

  private idOf(question: Question): string {
    for (const [id, q] of this.practice) if (q === question) return id
    return 'check'
  }

  private async request(message: string | Part[]): Promise<void> {
    if (this.ended || !this.chat) return
    if (this.turns >= this.maxTurns) return this.outOfTurns()
    this.turns++
    this.update({ phase: 'thinking' })
    const timeoutMs = this.opts.timeoutMs ?? TUTOR_TIMEOUT_MS
    let broken = false
    const send = async () => {
      if (broken) this.chat = this.opts.model.startChat({ systemInstruction: SYSTEM_INSTRUCTION, history: this.history })
      const chat = this.chat!
      try {
        const result = await withTimeout(chat.sendMessage(message), timeoutMs)
        this.history = await chat.getHistory()
        return result
      } catch (e) {
        broken = true
        throw e
      }
    }
    let response
    try {
      ;({ response } = await withBusyRetry(
        send,
        () => {
          if (!this.ended) this.update({ phase: 'busy' })
        },
        this.opts.sleep,
      ))
    } catch {
      return this.fail()
    }
    if (this.ended) return
    let calls: FunctionCall[]
    let text: string
    try {
      calls = response.functionCalls() ?? []
      text = response.text()
    } catch {
      return this.fail()
    }

    const replies: FunctionResponsePart[] = []
    let practiceIndex = -1
    for (const call of calls) {
      const reply = this.execute(call)
      if (this.ended) return
      if (reply === 'practice') practiceIndex = replies.length
      replies.push({
        type: 'functionResponse',
        functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: reply === 'practice' ? {} : reply },
      })
    }
    this.say(text)

    if (practiceIndex >= 0) {
      this.pending = { replies, index: practiceIndex }
      this.update({ phase: 'answering' })
      return
    }
    return this.request(replies.length > 0 ? replies : NUDGE)
  }

  private say(text: string) {
    const guardAnswer = (this.lastPractice ?? this.opts.checkQuestion).answer.value
    const trimmed = text.trim()
    if (trimmed && isSafeClue(trimmed, guardAnswer)) this.update({ items: [...this.view.items, { kind: 'say', text: trimmed }] })
  }

  private log(name: string, args: Record<string, unknown>, error: string | null, by: 'model' | 'app' = 'model') {
    const label = (TOOL_LABELS as Record<string, string>)[name] ?? `Unknown tool ${name}`
    this.calls = [...this.calls, { name, args, by }]
    this.update({ log: [...this.view.log, { kind: 'call', name, args, by, label, error }] })
    this.record(null)
  }

  private execute(call: FunctionCall): Record<string, unknown> | 'practice' {
    const args = isObj(call.args) ? call.args : {}
    const result = this.run(call.name, args)
    const error = result !== 'practice' && typeof result.error === 'string' ? result.error : null
    if (!this.ended) this.log(call.name, args, error)
    return result
  }

  private run(name: string, args: Record<string, unknown>): Record<string, unknown> | 'practice' {
    switch (name) {
      case 'getMistakeHistory':
        return { ...this.opts.summary.history }
      case 'makePractice':
        return this.makePractice(args)
      case 'showDiagram':
      case 'giveWorkedSolution': {
        const question = typeof args.questionId === 'string' ? this.practice.get(args.questionId) : undefined
        if (!question) return { error: 'No practice question with that questionId was made in this session.' }
        if (name === 'giveWorkedSolution' && question === this.view.awaiting) return { error: 'Wait for the child to answer first.' }
        this.update({ items: [...this.view.items, { kind: name === 'showDiagram' ? 'diagram' : 'steps', question }] })
        return { shown: true }
      }
      case 'navigate':
        return this.navigate(args.direction)
      default:
        return { error: `Unknown tool ${name}.` }
    }
  }

  private makePractice(args: Record<string, unknown>): Record<string, unknown> | 'practice' {
    const { idea } = this.opts
    const allowed = [...new Set([idea.checkQuestion.templateId, ...idea.practiceTemplates])]
    if (typeof args.templateId !== 'string' || !allowed.includes(args.templateId)) {
      return { error: 'That templateId does not belong to this idea.', allowed }
    }
    if (!(DIFFICULTIES as readonly unknown[]).includes(args.difficulty)) {
      return { error: 'difficulty must be easy, medium or hard.' }
    }
    if (this.view.awaiting) return { error: 'Wait for the child to answer the current practice question first.' }
    const newSeed = this.opts.newSeed ?? randomSeed
    const avoid = this.opts.checkQuestion.answer.value
    let question = generate(args.templateId, args.difficulty as LessonDifficulty, newSeed())
    for (let i = 0; i < 20 && question.answer.value === avoid; i++) {
      question = generate(args.templateId, args.difficulty as LessonDifficulty, newSeed())
    }
    const id = `p${this.practice.size + 1}`
    this.practice.set(id, question)
    this.lastPractice = question
    this.update({ awaiting: question, items: [...this.view.items, { kind: 'practice', question }] })
    return 'practice'
  }

  private navigate(direction: unknown): Record<string, unknown> {
    if (direction === 'stay') return { ok: true }
    if (direction === 'back') {
      if (!this.opts.hasPrevious) return { error: 'There is no previous idea.' }
      this.log('navigate', { direction }, null)
      this.finish('navigated')
      this.opts.onNavigate('back')
      return { ok: true }
    }
    if (direction === 'next') {
      if (!this.opts.isPassed()) return { error: 'The idea is not passed yet, so next is not allowed.' }
      this.log('navigate', { direction }, null)
      this.finish('navigated')
      this.opts.onNavigate('next')
      return { ok: true }
    }
    return { error: 'direction must be back, stay or next.' }
  }

  private outOfTurns() {
    const question = this.lastPractice ?? this.opts.checkQuestion
    this.log('giveWorkedSolution', { questionId: this.idOf(question) }, null, 'app')
    this.update({ items: [...this.view.items, { kind: 'steps', question }] })
    this.finish('out_of_turns')
  }
}
