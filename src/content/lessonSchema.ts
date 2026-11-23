import { listTemplates } from '../maths/registry'

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type LessonDifficulty = (typeof DIFFICULTIES)[number]

export interface TemplateRef {
  templateId: string
  difficulty: LessonDifficulty
}

export interface Idea {
  id: string
  order: number
  title: string
  explanation: string
  keyPoints: string[]
  workedExample: TemplateRef
  checkQuestion: TemplateRef
  practiceTemplates: string[]
  diagram: boolean
}

export interface Lesson {
  chapterId: string
  title: string
  source: { book: string; chapter: string; credit: string }
  ideas: Idea[]
}

export const templateIds = (): string[] => listTemplates().map((t) => t.id)

const templateRefSchema = () => ({
  type: 'object',
  properties: {
    templateId: { type: 'string', enum: templateIds() },
    difficulty: { type: 'string', enum: [...DIFFICULTIES] },
  },
  required: ['templateId', 'difficulty'],
  additionalProperties: false,
})

export function lessonJsonSchema() {
  return {
    type: 'object',
    properties: {
      chapterId: { type: 'string' },
      title: { type: 'string' },
      source: {
        type: 'object',
        properties: { book: { type: 'string' }, chapter: { type: 'string' }, credit: { type: 'string' } },
        required: ['book', 'chapter', 'credit'],
        additionalProperties: false,
      },
      ideas: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            order: { type: 'integer' },
            title: { type: 'string' },
            explanation: { type: 'string' },
            keyPoints: { type: 'array', minItems: 1, items: { type: 'string' } },
            workedExample: templateRefSchema(),
            checkQuestion: templateRefSchema(),
            practiceTemplates: { type: 'array', minItems: 1, items: { type: 'string', enum: templateIds() } },
            diagram: { type: 'boolean' },
          },
          required: [
            'id',
            'order',
            'title',
            'explanation',
            'keyPoints',
            'workedExample',
            'checkQuestion',
            'practiceTemplates',
            'diagram',
          ],
          additionalProperties: false,
        },
      },
    },
    required: ['chapterId', 'title', 'source', 'ideas'],
    additionalProperties: false,
  } as const
}

export interface LessonIssue {
  level: 'error' | 'warning'
  ideaIndex: number | null
  message: string
}

export interface ValidationResult {
  ok: boolean
  errors: LessonIssue[]
  warnings: LessonIssue[]
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

export function validateLesson(value: unknown): ValidationResult {
  const errors: LessonIssue[] = []
  const warnings: LessonIssue[] = []
  const err = (message: string, ideaIndex: number | null = null) => errors.push({ level: 'error', ideaIndex, message })
  const warn = (message: string, ideaIndex: number | null) => warnings.push({ level: 'warning', ideaIndex, message })
  const done = (): ValidationResult => ({ ok: errors.length === 0, errors, warnings })

  if (!isObj(value)) {
    err('The lesson is not an object.')
    return done()
  }
  for (const k of ['chapterId', 'title'] as const) if (!isStr(value[k]) || !value[k]) err(`Lesson ${k} must be text.`)
  const source = value.source
  if (!isObj(source)) err('Lesson source is missing.')
  else for (const k of ['book', 'chapter', 'credit']) if (!isStr(source[k]) || !source[k]) err(`Lesson source.${k} must be text.`)

  const ideas = value.ideas
  if (!Array.isArray(ideas)) {
    err('Lesson ideas must be a list.')
    return done()
  }
  if (ideas.length === 0) err('The lesson needs at least one idea.')

  const known = new Set(templateIds())
  const seen = new Set<string>()
  const checkRef = (ref: unknown, label: string, i: number) => {
    if (!isObj(ref)) return err(`${label} is missing.`, i)
    if (!isStr(ref.templateId) || !known.has(ref.templateId)) err(`${label}: unknown question type "${String(ref.templateId)}".`, i)
    if (!(DIFFICULTIES as readonly unknown[]).includes(ref.difficulty)) err(`${label}: difficulty must be easy, medium or hard.`, i)
  }

  ideas.forEach((idea: unknown, i) => {
    if (!isObj(idea)) return err('This idea is not an object.', i)
    if (!isStr(idea.id) || !idea.id) err('Idea id must be text.', i)
    else if (seen.has(idea.id)) err(`Idea id "${idea.id}" is used more than once.`, i)
    else seen.add(idea.id)
    if (idea.order !== i + 1) err(`Idea order is ${String(idea.order)} but should be ${i + 1}.`, i)
    if (!isStr(idea.title) || !idea.title.trim()) err('Idea title is empty.', i)
    else if (/\d/.test(idea.title)) warn('The title contains digits. Numbers should come from the maths engine.', i)
    if (!isStr(idea.explanation) || !idea.explanation.trim()) err('Idea explanation is empty.', i)
    else if (/\d/.test(idea.explanation)) warn('The explanation contains digits. Numbers should come from the maths engine.', i)
    if (!Array.isArray(idea.keyPoints) || !idea.keyPoints.every(isStr)) err('Key points must be a list of text.', i)
    else if (idea.keyPoints.length === 0) err('Add at least one key point.', i)
    else {
      if (idea.keyPoints.some((k) => !k.trim())) err('A key point is empty.', i)
      if (idea.keyPoints.some((k) => /\d/.test(k))) warn('A key point contains digits. Numbers should come from the maths engine.', i)
    }
    checkRef(idea.workedExample, 'Worked example', i)
    checkRef(idea.checkQuestion, 'Check question', i)
    if (!Array.isArray(idea.practiceTemplates)) err('Practice templates must be a list.', i)
    else {
      if (idea.practiceTemplates.length === 0) err('Pick at least one practice question type.', i)
      for (const t of idea.practiceTemplates)
        if (!isStr(t) || !known.has(t)) err(`Practice: unknown question type "${String(t)}".`, i)
    }
    if (typeof idea.diagram !== 'boolean') err('Diagram must be true or false.', i)
  })
  return done()
}

export function renumber(lesson: Lesson): Lesson {
  return { ...lesson, ideas: lesson.ideas.map((idea, i) => ({ ...idea, id: `idea-${i + 1}`, order: i + 1 })) }
}
