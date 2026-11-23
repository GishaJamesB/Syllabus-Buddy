import { describe, expect, it, vi } from 'vitest'
import { templateIds } from '../content/lessonSchema'
import {
  buildPrompt,
  checkPdfFile,
  draftLesson,
  isBusyError,
  MAX_PDF_BYTES,
  parseDraft,
  RETRY_DELAYS_MS,
  SKIPPED_SECTIONS,
  toBase64,
  withBusyRetry,
} from './draftLesson'

const busy = new Error('AI: Error fetching from https://x/models/m:generateContent: [500 ] This model is currently experiencing high demand.')
const noSleep = () => Promise.resolve()

describe('withBusyRetry', () => {
  it('recognises busy errors and ignores others', () => {
    expect(isBusyError(busy)).toBe(true)
    expect(isBusyError(new Error('[503 ] Service Unavailable'))).toBe(true)
    expect(isBusyError(new Error('[400 ] Bad request'))).toBe(false)
  })

  it('retries busy errors and returns the first success', async () => {
    const call = vi.fn().mockRejectedValueOnce(busy).mockRejectedValueOnce(busy).mockResolvedValue('ok')
    const onRetry = vi.fn()
    await expect(withBusyRetry(call, onRetry, noSleep)).resolves.toBe('ok')
    expect(call).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, RETRY_DELAYS_MS[0])
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, RETRY_DELAYS_MS[1])
  })

  it('gives up after the last delay and rethrows', async () => {
    const call = vi.fn().mockRejectedValue(busy)
    await expect(withBusyRetry(call, () => {}, noSleep)).rejects.toBe(busy)
    expect(call).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1)
  })

  it('does not retry other errors', async () => {
    const bad = new Error('[400 ] Bad request')
    const call = vi.fn().mockRejectedValue(bad)
    await expect(withBusyRetry(call, () => {}, noSleep)).rejects.toBe(bad)
    expect(call).toHaveBeenCalledTimes(1)
  })
})

describe('buildPrompt', () => {
  it('lists every template id and every skipped section', () => {
    const p = buildPrompt()
    for (const id of templateIds()) expect(p).toContain(id)
    for (const s of SKIPPED_SECTIONS) expect(p).toContain(s)
    expect(p).toContain('12-year-old')
    expect(p).toContain(`${templateIds().length} supported`)
  })
})

describe('checkPdfFile', () => {
  it('accepts a small pdf', () => {
    expect(checkPdfFile({ name: 'a.pdf', type: 'application/pdf', size: 1000 }).ok).toBe(true)
  })
  it('rejects a png', () => {
    expect(checkPdfFile({ name: 'a.png', type: 'image/png', size: 1000 }).ok).toBe(false)
  })
  it('rejects an empty file', () => {
    expect(checkPdfFile({ name: 'a.pdf', type: 'application/pdf', size: 0 }).ok).toBe(false)
  })
  it('accepts a .pdf name with an empty mime type', () => {
    expect(checkPdfFile({ name: 'A.PDF', type: '', size: 10 }).ok).toBe(true)
  })
  it('rejects a pdf over 14 MB', () => {
    expect(checkPdfFile({ name: 'a.pdf', type: 'application/pdf', size: MAX_PDF_BYTES + 1 }).ok).toBe(false)
  })
})

describe('draftLesson', () => {
  it('sends the pdf as inlineData and returns a draft that fails validation when it has no ideas', async () => {
    const generateContent = vi.fn().mockResolvedValue({ response: { text: () => '{"ideas":[]}' } })
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'a.pdf', { type: 'application/pdf' })
    const draft = await draftLesson({ generateContent }, file)
    const parts = generateContent.mock.calls[0][0] as { inlineData?: { mimeType: string; data: string } }[]
    expect(parts[1].inlineData).toEqual({ mimeType: 'application/pdf', data: 'JVBERg==' })
    expect(draft.validation.ok).toBe(false)
  })
  it('throws a friendly error on invalid JSON', () => {
    expect(() => parseDraft('not json')).toThrow(/valid JSON/)
  })
})

describe('toBase64', () => {
  it('matches Buffer for a multi-chunk input', () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 3 }, (_, i) => (i * 31) % 256)
    expect(toBase64(bytes)).toBe(btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')))
  })
})

describe('parseDraft normaliser', () => {
  const goodIdea = {
    id: 'x',
    order: 9,
    title: 'T',
    explanation: 'E',
    keyPoints: ['k'],
    workedExample: { templateId: 'perim_rectangle', difficulty: 'easy' },
    checkQuestion: { templateId: 'perim_square', difficulty: 'easy' },
    practiceTemplates: ['perim_triangle'],
    diagram: true,
  }
  it('throws a friendly error for null, {} and non-array ideas', () => {
    for (const v of ['null', '{}', '{"ideas":"no"}']) expect(() => parseDraft(v)).toThrow(/list of ideas|lesson/)
  })
  it('fills defaults for an idea missing fields', () => {
    const d = parseDraft(JSON.stringify({ title: 'L', ideas: [{ title: 'A' }, 5] }))
    expect(d.lesson.ideas).toHaveLength(1)
    const idea = d.lesson.ideas[0]
    expect(idea.keyPoints).toEqual([])
    expect(idea.practiceTemplates).toEqual([])
    expect(idea.workedExample).toEqual({ templateId: templateIds()[0], difficulty: 'easy' })
    expect(d.validation.ok).toBe(false)
    expect(d.notes.length).toBe(1)
  })
  it('maps a bad difficulty to easy and drops unknown practice ids with notes', () => {
    const d = parseDraft(
      JSON.stringify({ title: 'L', ideas: [{ ...goodIdea, checkQuestion: { templateId: 'perim_square', difficulty: 'tough' }, practiceTemplates: ['nope', 'perim_triangle'] }] }),
    )
    expect(d.lesson.ideas[0].checkQuestion.difficulty).toBe('easy')
    expect(d.lesson.ideas[0].practiceTemplates).toEqual(['perim_triangle'])
    expect(d.notes).toHaveLength(2)
    expect(d.validation.ok).toBe(true)
  })
  it('forces chapterId and source, and renumbers ids', () => {
    const d = parseDraft(JSON.stringify({ chapterId: 'zzz', source: {}, ideas: [goodIdea, goodIdea] }))
    expect(d.lesson.chapterId).toBe('ch6')
    expect(d.lesson.source.credit).toContain('NCERT')
    expect(d.lesson.ideas.map((i) => [i.id, i.order])).toEqual([['idea-1', 1], ['idea-2', 2]])
  })
})
