import type { Part } from 'firebase/ai'
import {
  DIFFICULTIES,
  renumber,
  templateIds,
  validateLesson,
  type Idea,
  type Lesson,
  type LessonDifficulty,
  type LessonIssue,
  type TemplateRef,
  type ValidationResult,
} from '../content/lessonSchema'

export const MAX_PDF_BYTES = 14 * 1024 * 1024
export const DRAFT_TIMEOUT_MS = 180_000
export const DRAFT_MODEL = 'gemini-3.8-flash'

export const SKIPPED_SECTIONS = ['grid counting', 'tangrams', 'tracks', 'house plans', 'area mazes']

export type FileCheck = { ok: true } | { ok: false; message: string }

export function checkPdfFile(file: { name: string; type: string; size: number }): FileCheck {
  const isPdf = file.type === 'application/pdf' || (file.type === '' && /\.pdf$/i.test(file.name))
  if (!isPdf) return { ok: false, message: 'Please choose a PDF file.' }
  if (file.size > MAX_PDF_BYTES) return { ok: false, message: 'That PDF is bigger than 14 MB. Please choose a smaller file.' }
  if (file.size === 0) return { ok: false, message: 'That file is empty.' }
  return { ok: true }
}

export function buildPrompt(): string {
  return [
    'You are drafting a lesson file from the attached NCERT maths chapter (Ganita Prakash, Grade 6, Chapter 6, Perimeter and Area).',
    'Return one idea for each teachable section, in the same order the sections appear in the chapter.',
    `Only use these ${templateIds().length} supported question types as templateId values: ${templateIds().join(', ')}.`,
    `Skip sections that need unsupported activities: ${SKIPPED_SECTIONS.join(', ')}.`,
    'Write each title, explanation and key point for a 12-year-old, in short friendly sentences.',
    'Never put computed numbers, answers or measurements in explanations or key points. The app produces all numbers, answers and diagrams from the templateId.',
    'For each idea pick a worked example and a check question (templateId and difficulty easy, medium or hard), a few practice templateIds, and set diagram to true when a figure helps.',
    'Use ids like "idea-1", order starting at 1 and going up by 1, chapterId "ch6", and put the NCERT credit in source.credit.',
    'Respond with JSON only.',
  ].join('\n')
}

export function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

export interface Draft {
  lesson: Lesson
  validation: ValidationResult
  notes: LessonIssue[]
}

export type CloudModel = {
  generateContent: (request: Part[]) => Promise<{ response: { text: () => string } }>
}

export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000]

export function isBusyError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /\[(500|503)\b|high demand|overloaded|unavailable/i.test(msg)
}

export async function withBusyRetry<T>(
  call: () => Promise<T>,
  onRetry: (attempt: number, waitMs: number) => void = () => {},
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call()
    } catch (e) {
      const waitMs = RETRY_DELAYS_MS[attempt]
      if (waitMs === undefined || !isBusyError(e)) throw e
      onRetry(attempt + 1, waitMs)
      await sleep(waitMs)
    }
  }
}

export async function draftLesson(
  model: CloudModel,
  file: File,
  onRetry?: (attempt: number, waitMs: number) => void,
): Promise<Draft> {
  const base64 = toBase64(new Uint8Array(await file.arrayBuffer()))
  const { response } = await withBusyRetry(
    () =>
      model.generateContent([
        { type: 'text', text: buildPrompt() },
        { type: 'inlineData', inlineData: { mimeType: 'application/pdf', data: base64 } },
      ]),
    onRetry,
  )
  return parseDraft(response.text())
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string => (typeof v === 'string' ? v : '')

export const LESSON_SOURCE = {
  book: 'Ganita Prakash, Grade 6',
  chapter: '6. Perimeter and Area',
  credit: 'Content based on NCERT Ganita Prakash, Grade 6, Chapter 6 (NCERT, New Delhi).',
}

export function normalizeLesson(value: unknown): { lesson: Lesson; notes: LessonIssue[] } {
  if (!isObj(value) || !Array.isArray(value.ideas)) throw new Error('The model did not return a lesson with a list of ideas. Please try again.')
  const notes: LessonIssue[] = []
  const known = new Set(templateIds())
  const note = (message: string) => notes.push({ level: 'warning', ideaIndex: null, message })
  const rawIdeas = value.ideas.filter(isObj)
  if (rawIdeas.length < value.ideas.length) note(`${value.ideas.length - rawIdeas.length} malformed idea(s) were dropped.`)

  const ref = (v: unknown, label: string, n: number): TemplateRef => {
    const r = isObj(v) ? v : {}
    const templateId = typeof r.templateId === 'string' && r.templateId ? r.templateId : templateIds()[0]
    let difficulty = r.difficulty as LessonDifficulty
    if (!(DIFFICULTIES as readonly unknown[]).includes(difficulty)) {
      difficulty = 'easy'
      if (isObj(v)) note(`Idea ${n}: ${label} difficulty was not valid and was set to easy.`)
    }
    return { templateId, difficulty }
  }

  const ideas: Idea[] = rawIdeas.map((raw, i) => {
    const n = i + 1
    const practice = Array.isArray(raw.practiceTemplates) ? raw.practiceTemplates : []
    const keyPoints = Array.isArray(raw.keyPoints) ? raw.keyPoints.filter((k): k is string => typeof k === 'string').map((k) => k.trim()).filter(Boolean) : []
    for (const t of practice.filter((t) => typeof t !== 'string' || !known.has(t))) note(`Idea ${n}: unknown practice type "${String(t)}" was removed.`)
    return {
      id: text(raw.id),
      order: n,
      title: text(raw.title),
      explanation: text(raw.explanation),
      keyPoints,
      workedExample: ref(raw.workedExample, 'worked example', n),
      checkQuestion: ref(raw.checkQuestion, 'check question', n),
      practiceTemplates: practice.filter((t): t is string => typeof t === 'string' && known.has(t)),
      diagram: raw.diagram === true,
    }
  })
  const lesson = renumber({ chapterId: 'ch6', title: text(value.title), source: { ...LESSON_SOURCE }, ideas })
  return { lesson, notes }
}

export function parseDraft(raw: string): Draft {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('The model did not return valid JSON. Please try again.')
  }
  const { lesson, notes } = normalizeLesson(value)
  return { lesson, validation: validateLesson(lesson), notes }
}
