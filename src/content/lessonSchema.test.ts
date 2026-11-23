import { describe, expect, it } from 'vitest'
import { listTemplates } from '../maths/registry'
import { lessonJsonSchema, renumber, templateIds, validateLesson, type Lesson } from './lessonSchema'

const idea = (n: number, over: Record<string, unknown> = {}) => ({
  id: `idea-${n}`,
  order: n,
  title: 'Perimeter',
  explanation: 'The distance around a shape.',
  keyPoints: ['Add all the sides'],
  workedExample: { templateId: 'perim_rectangle', difficulty: 'easy' },
  checkQuestion: { templateId: 'perim_square', difficulty: 'easy' },
  practiceTemplates: ['perim_triangle'],
  diagram: true,
  ...over,
})
const lesson = (ideas: unknown[]) => ({
  chapterId: 'ch6',
  title: 'Perimeter and Area',
  source: { book: 'Ganita Prakash', chapter: 'Chapter 6', credit: 'NCERT' },
  ideas,
})

describe('validateLesson', () => {
  it('accepts a valid lesson', () => {
    const r = validateLesson(lesson([idea(1), idea(2)]))
    expect(r.ok).toBe(true)
    expect(r.warnings).toHaveLength(0)
  })
  it('rejects a lesson with no ideas', () => {
    expect(validateLesson(lesson([])).ok).toBe(false)
  })
  it('rejects non-objects and missing fields', () => {
    expect(validateLesson(null).ok).toBe(false)
    expect(validateLesson({ ideas: [] }).ok).toBe(false)
  })
  it('flags an unknown template on that idea', () => {
    const r = validateLesson(lesson([idea(1, { workedExample: { templateId: 'nope', difficulty: 'easy' } })]))
    expect(r.ok).toBe(false)
    expect(r.errors[0].ideaIndex).toBe(0)
  })
  it('flags an unknown practice template and bad difficulty', () => {
    expect(validateLesson(lesson([idea(1, { practiceTemplates: ['nope'] })])).ok).toBe(false)
    expect(validateLesson(lesson([idea(1, { checkQuestion: { templateId: 'perim_square', difficulty: 'tough' } })])).ok).toBe(false)
  })
  it('flags duplicate ids', () => {
    expect(validateLesson(lesson([idea(1), idea(2, { id: 'idea-1' })])).ok).toBe(false)
  })
  it('flags non-contiguous order', () => {
    expect(validateLesson(lesson([idea(1), idea(3)])).ok).toBe(false)
  })
  it('warns, but does not fail, on digits in an explanation', () => {
    const r = validateLesson(lesson([idea(1, { explanation: 'A 12 by 8 rectangle' })]))
    expect(r.ok).toBe(true)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0].ideaIndex).toBe(0)
  })
})

describe('lessonJsonSchema', () => {
  it('restricts template ids to the registry', () => {
    expect(templateIds()).toHaveLength(listTemplates().length)
    const s = lessonJsonSchema()
    expect(s.properties.ideas.items.properties.workedExample.properties.templateId.enum).toEqual(templateIds())
    expect(s.properties.ideas.items.properties.practiceTemplates.items.enum).toEqual(templateIds())
  })
})

describe('validateLesson minimums', () => {
  it('rejects an empty key point and an empty key point list', () => {
    expect(validateLesson(lesson([idea(1, { keyPoints: ['a', ' '] })])).ok).toBe(false)
    expect(validateLesson(lesson([idea(1, { keyPoints: [] })])).ok).toBe(false)
  })
  it('rejects empty practice templates', () => {
    expect(validateLesson(lesson([idea(1, { practiceTemplates: [] })])).ok).toBe(false)
  })
  it('warns on digits in title and key points', () => {
    const r = validateLesson(lesson([idea(1, { title: 'Area 2', keyPoints: ['use 4'] })]))
    expect(r.ok).toBe(true)
    expect(r.warnings).toHaveLength(2)
  })
})

describe('renumber', () => {
  it('reassigns order and id and keeps other fields', () => {
    const l = lesson([idea(3, { title: 'A' }), idea(1, { title: 'B' })]) as unknown as Lesson
    const r = renumber(l)
    expect(r.ideas.map((i) => [i.id, i.order, i.title])).toEqual([['idea-1', 1, 'A'], ['idea-2', 2, 'B']])
    expect(r.ideas[0].keyPoints).toEqual(['Add all the sides'])
    expect(r.title).toBe(l.title)
  })
})
