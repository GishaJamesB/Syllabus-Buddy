// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import lessonJson from '../content/ch6.lesson.json'
import type { Idea, Lesson } from '../content/lessonSchema'
import type { Question } from '../maths/types'
import LearnerApp from './LearnerApp'
import { checkQuestion, firstCheckSeed, freshSeed, MISSES_BEFORE_HELP } from './progress'
import { memoryStore, openStore, type Store } from './store'

const lesson = lessonJson as Lesson
let n = 0

afterEach(cleanup)

function dbOpener() {
  const name = `ui-db-${++n}`
  return () => openStore(name)
}

const firstQuestion = (idea: Idea): Question => checkQuestion(idea, firstCheckSeed(idea))

function failingOpener(override: Partial<Store>) {
  const open = dbOpener()
  return async (): Promise<Store> => ({ ...(await open()), ...override })
}

const BANNER = "Progress won't be saved on this device"

async function start(open: () => Promise<Store>, lessonData: unknown = lessonJson) {
  render(<LearnerApp open={open} lessonData={lessonData} />)
  await screen.findByText("Who's learning?")
}

async function addNickname(name: string) {
  fireEvent.change(screen.getByLabelText('Add a nickname'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Start learning' }))
}

function type(text: string, unit: string | null) {
  fireEvent.change(screen.getByLabelText(/^Your answer/), { target: { value: text } })
  if (unit && unit !== 'S$') fireEvent.click(screen.getByRole('button', { name: unit }))
  fireEvent.click(screen.getByRole('button', { name: 'Check my answer' }))
}

const status = () => screen.getAllByRole('status').map((s) => s.textContent).join(' ')
const nextButton = () => screen.getByRole('button', { name: /^(Next|Finish)$/ })

describe('LearnerApp', () => {
  it('focuses the add form on a first visit and shows the hint', async () => {
    await start(dbOpener())
    expect(document.activeElement).toBe(screen.getByLabelText('Add a nickname'))
    expect(screen.getByText('Use a fun nickname, not your real name.')).toBeTruthy()
  })

  it('refuses a duplicate nickname case-insensitively', async () => {
    const open = dbOpener()
    await start(open)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    fireEvent.click(screen.getByRole('button', { name: 'Switch learner' }))
    await screen.findByRole('button', { name: 'Riya' })
    await addNickname('riya ')
    expect(await screen.findByText('That nickname is taken on this device')).toBeTruthy()
    expect((await (await open()).listProfiles()).length).toBe(1)
  })

  it('keeps Next disabled on wrong answers, gives unit feedback, and Back works', async () => {
    await start(dbOpener())
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    const q = firstQuestion(lesson.ideas[0])
    const lengthUnit = q.answer.unit

    type(String(q.answer.value), null)
    expect(status()).toContain("Don't forget the units")
    type('abc', lengthUnit === 'cm' ? 'sq cm' : 'sq m')
    expect(status()).toContain('Type a whole number')
    type(String(q.answer.value), null)
    expect(screen.getByRole('button', { name: lengthUnit === 'cm' ? 'sq cm' : 'sq m' }).getAttribute('aria-pressed')).toBe('true')
    expect(status()).toContain('Perimeter is a length, so use cm or m')
    expect((nextButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Show me how' })).toBeNull()

    type(String(q.answer.value), lengthUnit)
    await act(async () => {})
    expect(status()).toContain('That is right')
    expect((nextButton() as HTMLButtonElement).disabled).toBe(false)
    expect(document.activeElement).toBe(nextButton())

    fireEvent.click(nextButton())
    await screen.findByText('Idea 2 of 7')
    type('1', 'cm')
    expect((nextButton() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByText('Idea 1 of 7')
    expect((screen.getByLabelText(/^Your answer/) as HTMLInputElement).value).toBe(String(q.answer.value))
    expect((nextButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('reveals steps after three misses and then needs a fresh question', async () => {
    await start(dbOpener())
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    const q = firstQuestion(lesson.ideas[0])
    for (let i = 0; i < MISSES_BEFORE_HELP; i++) type('1', q.answer.unit)
    fireEvent.click(screen.getByRole('button', { name: 'Show me how' }))
    expect(screen.getByText(q.steps[q.steps.length - 1])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try a new question' }))
    expect(screen.queryByText(q.prompt)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show me how' })).toBeNull()
  })

  it('accepts a dollar answer as S$480, $480 or 480 with no unit buttons', async () => {
    const dollarLesson: Lesson = {
      ...lesson,
      ideas: [{ ...lesson.ideas[0], checkQuestion: { templateId: 'perim_fencing_cost', difficulty: 'easy' } }],
    }
    const q = firstQuestion(dollarLesson.ideas[0])
    expect(q.prompt).toContain('S$')
    for (const text of [`S$${q.answer.value}`, `$${q.answer.value}`, String(q.answer.value)]) {
      cleanup()
      await start(memoryOpener(), dollarLesson)
      await addNickname('Riya')
      await screen.findByText('Idea 1 of 1')
      expect(screen.getByLabelText('Your answer in dollars')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'cm' })).toBeNull()
      type(text, 'S$')
      expect(status()).toContain('That is right')
    }
  })

  it('passes all ideas in order, finishes, and starts again', async () => {
    const open = dbOpener()
    await start(open)
    await addNickname('Riya')
    for (const [i, idea] of lesson.ideas.entries()) {
      await screen.findByText(`Idea ${i + 1} of 7`)
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(idea.title)
      const q = firstQuestion(idea)
      type(String(q.answer.value), q.answer.unit)
      fireEvent.click(nextButton())
    }
    expect(await screen.findByText('Chapter complete')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    await screen.findByText('Idea 1 of 7')
    expect((nextButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('resumes on the same idea and question after a reload', async () => {
    const open = dbOpener()
    await start(open)
    await addNickname('Riya')
    for (const idea of lesson.ideas.slice(0, 3)) {
      await screen.findByText(`Idea ${idea.order} of 7`)
      const q = firstQuestion(idea)
      type(String(q.answer.value), q.answer.unit)
      fireEvent.click(nextButton())
    }
    await screen.findByText('Idea 4 of 7')
    const prompt = firstQuestion(lesson.ideas[3]).prompt
    expect(screen.getByText(prompt)).toBeTruthy()
    await act(async () => {})
    cleanup()

    await start(open)
    fireEvent.click(screen.getByRole('button', { name: 'Riya' }))
    await screen.findByText('Idea 4 of 7')
    expect(screen.getByText(prompt)).toBeTruthy()

    const idea4 = lesson.ideas[3]
    const unit = firstQuestion(idea4).answer.unit
    for (let i = 0; i < MISSES_BEFORE_HELP; i++) type('999999', unit)
    fireEvent.click(screen.getByRole('button', { name: 'Show me how' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try a new question' }))
    const freshPrompt = checkQuestion(idea4, freshSeed(idea4, firstCheckSeed(idea4))).prompt
    expect(freshPrompt).not.toBe(prompt)
    expect(screen.getByText(freshPrompt)).toBeTruthy()
    await act(async () => {})
    cleanup()

    await start(open)
    fireEvent.click(screen.getByRole('button', { name: 'Riya' }))
    await screen.findByText('Idea 4 of 7')
    expect(screen.getByText(freshPrompt)).toBeTruthy()
  })

  it('works in memory with a banner when IndexedDB is blocked', async () => {
    await start(memoryOpener())
    expect(screen.getByText(BANNER)).toBeTruthy()
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
  })

  it('shows the banner when saving progress fails', async () => {
    await start(failingOpener({ saveProfile: () => Promise.reject(new Error('quota')) }))
    expect(screen.queryByText(BANNER)).toBeNull()
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    type('999999', 'cm')
    expect(await screen.findByText(BANNER)).toBeTruthy()
  })

  it('shows the picker and the banner when listing profiles fails', async () => {
    await start(failingOpener({ listProfiles: () => Promise.reject(new Error('broken')) }))
    expect(screen.getByText(BANNER)).toBeTruthy()
  })

  it('still starts the lesson when adding a profile fails', async () => {
    await start(failingOpener({ addProfile: () => Promise.reject(new Error('broken')) }))
    expect(screen.queryByText(BANNER)).toBeNull()
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    expect(screen.getByText(BANNER)).toBeTruthy()
  })

  it('shows a friendly error for an invalid lesson', async () => {
    render(<LearnerApp open={memoryOpener()} lessonData={{ ideas: [] }} />)
    expect(screen.getByRole('alert').textContent).toContain('lesson could not be loaded')
  })
})

function memoryOpener() {
  return async () => memoryStore()
}
