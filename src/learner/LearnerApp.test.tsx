// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InferenceSource } from '../ai/buddy'
import type { OnDeviceStatus } from '../ai/onDeviceStatus'
import { createBuddyService, type BuddyService } from '../ai/useBuddy'
import lessonJson from '../content/ch6.lesson.json'
import type { InferenceModeValue } from '../firebase/config'
import type { Idea, Lesson } from '../content/lessonSchema'
import type { Question } from '../maths/types'
import LearnerApp from './LearnerApp'
import { checkQuestion, firstCheckSeed, freshSeed, mistakeHistory, MISSES_BEFORE_HELP } from './progress'
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

const restingBuddy = () => createBuddyService(() => Promise.reject(new Error('no env')))

async function start(open: () => Promise<Store>, lessonData: unknown = lessonJson, buddy: BuddyService = restingBuddy()) {
  render(<LearnerApp open={open} lessonData={lessonData} buddy={buddy} />)
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

type Answer = { text: string; source?: InferenceSource } | Error

interface FakeOptions {
  mode?: InferenceModeValue
  nano?: OnDeviceStatus
  load?: Promise<void>
}

function fakeBuddy({ mode = 'prefer_on_device', nano = 'available', load }: FakeOptions = {}) {
  const prompts: string[] = []
  const pending: { resolve: (a: Answer) => void }[] = []
  let deviceProgress: ((p: number) => void) | null = null
  let finishDownload: (() => void) | null = null
  let status = nano
  const service = createBuddyService(async () => {
    await load
    return {
      mode,
      onDeviceStatus: async () => status,
      createTurnModel: () => ({
        generateContent(prompt: string) {
          prompts.push(prompt)
          return new Promise<Answer>((resolve) => pending.push({ resolve })).then((a) => {
            if (a instanceof Error) throw a
            return { response: { text: () => a.text, inferenceSource: a.source } }
          })
        },
        initializeDeviceModel(cb?: (p: number) => void) {
          deviceProgress = cb ?? null
          return new Promise<void>((resolve) => {
            finishDownload = () => {
              status = 'available'
              resolve()
            }
          })
        },
      }),
    }
  })
  return {
    service,
    prompts,
    async reply(answer: Answer, index?: number) {
      await act(async () => {})
      await act(async () => {
        pending[index ?? pending.length - 1].resolve(answer)
      })
    },
    async progress(p: number) {
      await act(async () => deviceProgress?.(p))
    },
    async finishDownload() {
      await act(async () => finishDownload?.())
    },
  }
}

const json = (intent: string, misconception: string | null, clue: string | null) =>
  JSON.stringify({ intent, misconception, clue })

async function startWith(buddy: ReturnType<typeof fakeBuddy>, open = dbOpener()) {
  await start(open, lessonJson, buddy.service)
  await act(async () => {})
  return open
}

async function learnIdea2() {
  await addNickname('Riya')
  await screen.findByText('Idea 1 of 7')
  const q = firstQuestion(lesson.ideas[0])
  type(String(q.answer.value), q.answer.unit)
  fireEvent.click(nextButton())
  await screen.findByText('Idea 2 of 7')
}

function askBuddy(text: string) {
  fireEvent.change(screen.getByLabelText('Ask Buddy'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
}

async function saved(open: () => Promise<Store>) {
  await act(async () => {})
  return (await (await open()).listProfiles())[0]
}

describe('Buddy', () => {
  it('shows the fixed message at once, then an on-device clue, with the lesson usable meanwhile', async () => {
    const buddy = fakeBuddy()
    const open = await startWith(buddy)
    expect(screen.getByText('🔒 Ready on this device')).toBeTruthy()
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    const q = firstQuestion(lesson.ideas[0])

    type(String(q.answer.value), null)
    expect(status()).toContain("Don't forget the units")
    await screen.findByText('Buddy is thinking…')
    expect((screen.getByRole('button', { name: 'Check my answer' }) as HTMLButtonElement).disabled).toBe(false)
    expect(buddy.prompts[0]).not.toContain(`${q.answer.value} ${q.answer.unit}`)

    await buddy.reply({ text: json('answer_attempt', null, 'Which unit measures length?'), source: 'on_device' })
    expect(screen.getByText('Which unit measures length?')).toBeTruthy()
    expect(screen.getByText('🔒 On this device')).toBeTruthy()

    const turns = (await saved(open)).progress.buddyTurns
    expect(turns).toEqual([
      expect.objectContaining({
        ideaId: 'idea-1',
        kind: 'miss',
        reason: 'units_missing',
        code: 'units_missing',
        intent: 'answer_attempt',
        misconception: 'units_missing',
        source: 'on_device',
        outcome: 'ok',
      }),
    ])
  })

  it('badges a cloud clue', async () => {
    const buddy = fakeBuddy({ nano: 'unavailable' })
    await startWith(buddy)
    expect(screen.getByText('☁️ Using the cloud')).toBeTruthy()
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    expect(screen.getByText('Buddy uses the cloud on this computer')).toBeTruthy()
    type('1', 'cm')
    await buddy.reply({ text: json('answer_attempt', null, 'Add all the sides.'), source: 'in_cloud' })
    expect(screen.getByText('☁️ Cloud')).toBeTruthy()
  })

  it('shows the fixed message when the clue leaks the answer or the JSON is bad', async () => {
    const buddy = fakeBuddy()
    const open = await startWith(buddy)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    const q = firstQuestion(lesson.ideas[0])

    type(String(q.answer.value), null)
    await buddy.reply({ text: json('answer_attempt', null, `The answer is ${q.answer.value}`), source: 'on_device' })
    expect(screen.getAllByText("Don't forget the units").length).toBe(2)
    expect(screen.queryByText(`The answer is ${q.answer.value}`)).toBeNull()

    type('1', q.answer.unit)
    await buddy.reply({ text: 'not json', source: 'on_device' })
    expect(screen.getAllByText('Not quite. Look at the example again').length).toBe(2)
    expect((await saved(open)).progress.buddyTurns.map((t) => t.outcome)).toEqual(['guarded', 'guarded'])
  })

  it('rests when the model fails and makes no call for a non-number', async () => {
    const buddy = fakeBuddy()
    await startWith(buddy)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    type('abc', 'cm')
    await act(async () => {})
    expect(buddy.prompts).toHaveLength(0)
    expect(screen.queryByText('Buddy is thinking…')).toBeNull()

    type('1', 'cm')
    await buddy.reply(new Error('offline'))
    expect(screen.getByText('Buddy is resting right now')).toBeTruthy()
    expect(status()).toContain('Not quite')
  })

  it('handles the four Ask intents and never stores the typed text', async () => {
    const buddy = fakeBuddy()
    const open = await startWith(buddy)
    await learnIdea2()

    askBuddy("I don't get it")
    await buddy.reply({ text: json('needs_clue', null, 'Look at one side first.'), source: 'on_device' })
    expect(screen.getByText('Look at one side first.')).toBeTruthy()
    expect(screen.getByText('🔒 On this device')).toBeTruthy()

    askBuddy('I added 12 and 8')
    await buddy.reply({ text: json('answer_attempt', 'perim_two_sides_only', 'A square has four sides.'), source: 'on_device' })
    expect(screen.getByText('A square has four sides.')).toBeTruthy()

    askBuddy("what's for lunch")
    await buddy.reply({ text: json('off_topic', null, null), source: 'on_device' })
    expect(screen.getByText(`Let's get back to ${lesson.ideas[1].title}!`)).toBeTruthy()

    askBuddy('can I see the last one')
    await buddy.reply({ text: json('review_previous', null, 'Rectangles came first.'), source: 'on_device' })
    expect(screen.getByText('Rectangles came first.')).toBeTruthy()

    const profile = await saved(open)
    expect(JSON.stringify(profile)).not.toMatch(/lunch|added 12|get it|last one/)
    expect(profile.progress.buddyTurns.map((t) => [t.kind, t.intent, t.misconception])).toEqual([
      ['ask', 'needs_clue', null],
      ['ask', 'answer_attempt', 'perim_two_sides_only'],
      ['ask', 'off_topic', null],
      ['ask', 'review_previous', null],
    ])
    expect(mistakeHistory(profile)).toEqual({ perim_two_sides_only: 1 })

    fireEvent.click(screen.getByRole('button', { name: `Go back to: ${lesson.ideas[0].title}` }))
    await screen.findByText('Idea 1 of 7')
  })

  it('hides the go-back button on the first idea', async () => {
    const buddy = fakeBuddy()
    await startWith(buddy)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    askBuddy('can I see the last one')
    await buddy.reply({ text: json('review_previous', null, 'Read the key points.'), source: 'on_device' })
    expect(screen.getByText('Read the key points.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Go back to/ })).toBeNull()
  })

  it('drops a reply when a newer request exists or the idea changed', async () => {
    const buddy = fakeBuddy()
    const open = await startWith(buddy)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    type('1', 'cm')
    type('2', null)
    await buddy.reply({ text: json('answer_attempt', null, 'Old clue.'), source: 'on_device' }, 0)
    expect(screen.queryByText('Old clue.')).toBeNull()
    expect(screen.getByText('Buddy is thinking…')).toBeTruthy()
    await buddy.reply({ text: json('answer_attempt', null, 'New clue.'), source: 'on_device' }, 1)
    expect(screen.getByText('New clue.')).toBeTruthy()

    type('3', null)
    const q = firstQuestion(lesson.ideas[0])
    expect(q.answer.unit).toBe('cm')
    type(String(q.answer.value), null)
    fireEvent.click(nextButton())
    await screen.findByText('Idea 2 of 7')
    await buddy.reply({ text: json('answer_attempt', null, 'Late clue.'), source: 'on_device' }, 2)
    expect(screen.queryByText('Late clue.')).toBeNull()
    expect((await saved(open)).progress.buddyTurns).toHaveLength(1)
  })

  it('waits for Firebase before a turn made while starting', async () => {
    let release!: () => void
    const buddy = fakeBuddy({ load: new Promise<void>((r) => (release = r)) })
    await startWith(buddy)
    expect(screen.getByText('Waking Buddy up…')).toBeTruthy()
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    type('1', 'cm')
    expect(screen.getByText('Buddy is thinking…')).toBeTruthy()
    expect(buddy.prompts).toHaveLength(0)
    await act(async () => release())
    await vi.waitFor(() => expect(buddy.prompts).toHaveLength(1))
    await buddy.reply({ text: json('answer_attempt', null, 'Add all the sides.'), source: 'in_cloud' })
    expect(screen.getByText('Add all the sides.')).toBeTruthy()
  })

  it('rests with the Ask box disabled when Firebase fails', async () => {
    await start(dbOpener())
    await act(async () => {})
    expect(screen.getByText('Buddy is resting')).toBeTruthy()
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    expect((screen.getByLabelText('Ask Buddy') as HTMLInputElement).disabled).toBe(true)
    type('1', 'cm')
    expect(await screen.findByText('Buddy is resting right now')).toBeTruthy()
    expect(status()).toContain('Not quite')
  })

  it('offers the on-device download and shows its progress', async () => {
    const buddy = fakeBuddy({ nano: 'downloadable' })
    await startWith(buddy)
    expect(screen.getByText('☁️ Using the cloud')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Get on-device Buddy' }))
    await act(async () => {})
    await buddy.progress(0.42)
    expect(screen.getByText('Downloading 42%')).toBeTruthy()
    await buddy.finishDownload()
    expect(screen.getByText('🔒 Ready on this device')).toBeTruthy()
  })

  it('removes the clue after a correct answer, before moving on', async () => {
    const buddy = fakeBuddy()
    await startWith(buddy)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    const q = firstQuestion(lesson.ideas[0])
    type('1', q.answer.unit)
    await buddy.reply({ text: json('answer_attempt', null, 'Add all the sides.'), source: 'on_device' })
    expect(screen.getByText('Add all the sides.')).toBeTruthy()
    type(String(q.answer.value), null)
    expect(screen.queryByText('Add all the sides.')).toBeNull()
    expect(screen.getByText('Idea 1 of 7')).toBeTruthy()
  })

  it('removes the clue and drops a pending reply after "Try a new question"', async () => {
    const buddy = fakeBuddy()
    const open = await startWith(buddy)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    type('1', 'cm')
    await buddy.reply({ text: json('answer_attempt', null, 'First clue.'), source: 'on_device' })
    type('2', null)
    await buddy.reply({ text: json('answer_attempt', null, 'Second clue.'), source: 'on_device' })
    type('3', null)
    fireEvent.click(screen.getByRole('button', { name: 'Show me how' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try a new question' }))
    await buddy.reply({ text: json('answer_attempt', null, 'Old question clue.'), source: 'on_device' })
    expect(screen.queryByText('Second clue.')).toBeNull()
    expect(screen.queryByText('Old question clue.')).toBeNull()
    expect((await saved(open)).progress.buddyTurns).toHaveLength(2)
  })

  it("does not show learner A's clue to a new learner B", async () => {
    const buddy = fakeBuddy()
    await startWith(buddy)
    await addNickname('Asha')
    await screen.findByText('Idea 1 of 7')
    type('1', 'cm')
    await buddy.reply({ text: json('answer_attempt', null, 'Clue for Asha.'), source: 'on_device' })
    type('2', null)
    fireEvent.click(screen.getByRole('button', { name: 'Switch learner' }))
    await screen.findByRole('button', { name: 'Asha' })
    await addNickname('Bilal')
    await screen.findByText('Idea 1 of 7')
    await buddy.reply({ text: json('answer_attempt', null, 'Late clue for Asha.'), source: 'on_device' })
    expect(screen.queryByText('Clue for Asha.')).toBeNull()
    expect(screen.queryByText('Late clue for Asha.')).toBeNull()
    expect(screen.queryByText('Buddy says')).toBeNull()
  })

  it('shows the cloud note during a download only when the cloud can be used', async () => {
    await startWith(fakeBuddy({ nano: 'downloading' }))
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    expect(screen.getByText('Buddy uses the cloud on this computer')).toBeTruthy()
    cleanup()
    await startWith(fakeBuddy({ mode: 'only_on_device', nano: 'downloading' }))
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    expect(screen.queryByText('Buddy uses the cloud on this computer')).toBeNull()
  })

  it('disables Ask and makes no call when on-device Buddy is needed', async () => {
    const buddy = fakeBuddy({ mode: 'only_on_device', nano: 'unavailable' })
    await startWith(buddy)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    expect((screen.getByLabelText('Ask Buddy') as HTMLInputElement).disabled).toBe(true)
    type('1', 'cm')
    await act(async () => {})
    expect(buddy.prompts).toHaveLength(0)
    expect(status()).toContain('Not quite')
  })

  it('shows the cloud, downloading and needs-device rows', async () => {
    for (const [options, label] of [
      [{ mode: 'only_in_cloud', nano: 'available' }, '☁️ Using the cloud'],
      [{ nano: 'downloading' }, 'Downloading…'],
      [{ mode: 'only_on_device', nano: 'unavailable' }, 'Needs on-device Buddy'],
    ] as [FakeOptions, string][]) {
      cleanup()
      await startWith(fakeBuddy(options))
      expect(screen.getByText(label)).toBeTruthy()
    }
  })
})
