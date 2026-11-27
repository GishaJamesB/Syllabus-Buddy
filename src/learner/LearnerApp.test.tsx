// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InferenceSource } from '../ai/buddy'
import type { OnDeviceStatus } from '../ai/onDeviceStatus'
import { createBuddyService, type BuddyService } from '../ai/useBuddy'
import lessonJson from '../content/ch6.lesson.json'
import type { InferenceModeValue } from '../firebase/config'
import type { AccountService, AccountStatus } from '../firebase/account'
import { answeredAt } from './RecentAnswers'
import type { Idea, Lesson } from '../content/lessonSchema'
import { generate } from '../maths/registry'
import { formatAnswer, type Question } from '../maths/types'
import LearnerApp from './LearnerApp'
import { checkQuestion, firstCheckSeed, freshSeed, mistakeHistory, MISSES_BEFORE_HELP, newProfile, recordAttempt } from './progress'
import { grade } from '../maths/grade'
import { memoryStore, openStore, type Store } from './store'
import { testQuestion, type TestRecord } from './test'
import { createRng } from '../maths/rng'
import { DEFAULT_TUNING, type TuningValues } from '../config/tuning'

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
  await loaded()
}

async function loaded() {
  await vi.waitFor(() => expect(screen.queryByText('Getting ready…')).toBeNull())
  await act(async () => {})
}

async function addNickname(name: string) {
  fireEvent.change(screen.getByLabelText('Add a nickname'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Start learning' }))
}

function type(text: string, unit: string | null, submit = 'Check my answer') {
  fireEvent.change(screen.getByLabelText(/^Your answer/), { target: { value: text } })
  if (unit && unit !== 'S$') fireEvent.click(screen.getByRole('button', { name: unit }))
  fireEvent.click(screen.getByRole('button', { name: submit }))
}

const status = () => screen.getAllByRole('status').map((s) => s.textContent).join(' ')
const nextButton = () => screen.getByRole('button', { name: /^(Next|Finish)$/ })

describe('LearnerApp', () => {
  it('focuses the add form on a first visit and shows the hint', async () => {
    await start(dbOpener())
    expect(document.activeElement).toBe(screen.getByLabelText('Add a nickname'))
    expect(screen.getByText('Use a fun nickname, not your real name.')).toBeTruthy()
  })

  it('opens the saved child straight away on the next visit', async () => {
    const open = dbOpener()
    await start(open)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    cleanup()
    await start(open)
    await screen.findByText('Idea 1 of 7')
    expect(screen.getByText('Hi, Riya!')).toBeTruthy()
    expect(screen.queryByLabelText('Add a nickname')).toBeNull()
    expect((await (await open()).listProfiles()).length).toBe(1)
  })

  it('greys out Check my answer when empty and after a check until the answer changes', async () => {
    const open = dbOpener()
    await start(open)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    const check = () => screen.getByRole('button', { name: 'Check my answer' }) as HTMLButtonElement
    expect(check().disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/^Your answer/), { target: { value: '999999' } })
    expect(check().disabled).toBe(false)
    fireEvent.click(check())
    fireEvent.click(check())
    expect(check().disabled).toBe(true)
    expect((await saved(open)).progress.attempts).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'cm' }))
    expect(check().disabled).toBe(false)
  })

  it('keeps Next disabled on wrong answers, gives unit feedback, and Back works', async () => {
    await start(dbOpener(), lessonJson, fakeBuddy({ tuning: { misses_before_help: 3 } }).service)
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

  it('reveals steps after the help threshold of misses and then needs a fresh question', async () => {
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
  tuning?: Partial<TuningValues>
  summary?: () => Promise<string>
}

function fakeBuddy({ mode = 'prefer_on_device', nano = 'available', load, tuning, summary }: FakeOptions = {}) {
  const prompts: string[] = []
  const pending: { resolve: (a: Answer) => void }[] = []
  let deviceProgress: ((p: number) => void) | null = null
  let finishDownload: (() => void) | null = null
  let status = nano
  const summaryPrompts: string[] = []
  const createSummaryModel = vi.fn(() => ({
    generateContent(prompt: string) {
      summaryPrompts.push(prompt)
      return (summary ?? (() => Promise.reject(new Error('no summary'))))().then((text) => ({ response: { text: () => text } }))
    },
  }))
  const service = createBuddyService(async () => {
    await load
    return {
      mode,
      tuning: { ...DEFAULT_TUNING, inference_mode: mode, ...tuning },
      createSummaryModel,
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
    summaryPrompts,
    createSummaryModel,
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
    fireEvent.change(screen.getByLabelText(/^Your answer/), { target: { value: '1' } })
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
    await screen.findByText("The tutor can't help right now")
    const q = firstQuestion(lesson.ideas[0])
    expect(q.answer.unit).toBe('cm')
    type(String(q.answer.value), 'cm')
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
    fireEvent.click(await screen.findByRole('button', { name: 'Show me how' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try a new question' }))
    await buddy.reply({ text: json('answer_attempt', null, 'Old question clue.'), source: 'on_device' })
    expect(screen.queryByText('Second clue.')).toBeNull()
    expect(screen.queryByText('Old question clue.')).toBeNull()
    expect((await saved(open)).progress.buddyTurns).toHaveLength(2)
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

type TutorStep = { calls?: { name: string; args?: Record<string, unknown> }[]; text?: string } | Error | 'hang'

function tutorBuddy(script: TutorStep[], mode: InferenceModeValue = 'prefer_on_device', tuning?: Partial<TuningValues>) {
  const requests: unknown[] = []
  const system: string[] = []
  const service = createBuddyService(async () => ({
    mode,
    tuning: { ...DEFAULT_TUNING, inference_mode: mode, ...tuning },
    onDeviceStatus: async () => 'available' as const,
    createTurnModel: () => ({ generateContent: () => Promise.reject(new Error('offline')) }),
    createTutorModel: () => ({
      startChat({ systemInstruction }: { systemInstruction: string }) {
        system.push(systemInstruction)
        return {
          async sendMessage(request: unknown) {
            requests.push(structuredClone(request))
            const step = script.shift() ?? {}
            if (step === 'hang') return new Promise<never>(() => {})
            if (step instanceof Error) throw step
            return {
              response: {
                text: () => step.text ?? '',
                functionCalls: () => step.calls?.map((c) => ({ name: c.name, args: c.args ?? {} })),
              },
            }
          },
          getHistory: async () => [],
        }
      },
    }),
  }))
  return { service, requests, system }
}

async function escalate(tutor: { service: BuddyService }, nickname = 'Zanzibar') {
  const open = dbOpener()
  await start(open, lessonJson, tutor.service)
  await act(async () => {})
  await addNickname(nickname)
  await screen.findByText('Idea 1 of 7')
  for (let i = 0; i < MISSES_BEFORE_HELP; i++) type('999999', 'cm')
  return open
}

const panelItems = () =>
  within(screen.getByRole('list', { name: 'What the AI did' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)

describe('Tutor', () => {
  afterEach(() => vi.restoreAllMocks())

  it('opens after the help threshold of misses, runs the scripted tools, and a correct practice answer passes the idea', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const practice = generate('perim_rectangle', 'medium', 500_000_000)
    const check = firstQuestion(lesson.ideas[0])
    expect(practice.answer.value).not.toBe(check.answer.value)
    const tutor = tutorBuddy([
      { calls: [{ name: 'getMistakeHistory' }] },
      {
        calls: [
          { name: 'makePractice', args: { templateId: 'perim_rectangle', difficulty: 'medium' } },
          { name: 'showDiagram', args: { questionId: 'p1' } },
        ],
        text: 'Try this one, add every side.',
      },
    ])
    const open = dbOpener()
    await start(open, lessonJson, tutor.service)
    await act(async () => {})
    await addNickname('Zanzibar')
    await screen.findByText('Idea 1 of 7')
    askBuddy('my secret sentence')
    await act(async () => {})
    for (let i = 0; i < MISSES_BEFORE_HELP; i++) type('999999', 'cm')

    expect(screen.getByText('☁️ Tutor')).toBeTruthy()
    expect(screen.queryByText('Buddy is thinking…')).toBeNull()
    await screen.findByText(practice.prompt)
    expect(screen.getByText('Sent to the cloud')).toBeTruthy()
    expect(screen.getByText('Try this one, add every side.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show me how' })).toBeNull()
    expect(screen.getAllByLabelText(/^Your answer/)).toHaveLength(1)

    type(String(practice.answer.value), practice.answer.unit)
    await screen.findByText("You've got it!")
    expect(screen.getByText('✔ Yes! That is right. Well done!')).toBeTruthy()
    expect((nextButton() as HTMLButtonElement).disabled).toBe(false)
    expect(panelItems().slice(1, 4).map((t) => t?.split('(')[0])).toEqual([
      'Looked at past mistakesgetMistakeHistory',
      'Made a practice questionmakePractice',
      'Drew a diagramshowDiagram',
    ])
    expect(panelItems().at(-1)).toBe('Ended: the idea is mastered')

    const profile = await saved(open)
    expect(profile.progress.passedIdeaIds).toEqual(['idea-1'])
    expect(profile.progress.attempts.at(-1)).toMatchObject({ correct: true, seed: practice.seed, templateId: 'perim_rectangle' })
    expect(profile.progress.tutorSessions).toEqual([
      {
        ideaId: 'idea-1',
        seed: check.seed,
        startedAt: expect.any(Number),
        calls: [
          { name: 'getMistakeHistory', args: {}, by: 'model' },
          { name: 'makePractice', args: { templateId: 'perim_rectangle', difficulty: 'medium' }, by: 'model' },
          { name: 'showDiagram', args: { questionId: 'p1' }, by: 'model' },
        ],
        results: [{ questionId: 'p1', templateId: 'perim_rectangle', correct: true, code: null }],
        outcome: 'mastered',
      },
    ])

    const sent = JSON.stringify([tutor.system, tutor.requests])
    expect(tutor.requests).toHaveLength(2)
    for (const secret of ['Zanzibar', 'secret sentence', '999999', formatAnswer(check.answer), formatAnswer(practice.answer)]) {
      expect(sent).not.toContain(secret)
    }
    expect(JSON.parse(tutor.requests[0] as string)).toEqual({
      idea: { title: lesson.ideas[0].title, keyPoints: lesson.ideas[0].keyPoints },
      templateId: 'perim_rectangle',
      difficulty: 'medium',
      misses: MISSES_BEFORE_HELP,
      mistakeCodes: [],
      history: {},
      maxTurns: 5,
    })
  })

  it('escalates after the tuned misses and stops after the tuned max turns', async () => {
    const tutor = tutorBuddy(
      Array.from({ length: 5 }, () => ({ calls: [{ name: 'getMistakeHistory' }] })),
      'prefer_on_device',
      { misses_before_help: 2, max_turns: 2 },
    )
    const open = dbOpener()
    await start(open, lessonJson, tutor.service)
    await act(async () => {})
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    type('999999', 'cm')
    expect(screen.queryByText('☁️ Tutor')).toBeNull()
    type('999999', 'cm')
    expect(screen.getByText('☁️ Tutor')).toBeTruthy()
    await screen.findByRole('button', { name: 'Try a new question' })
    expect(tutor.requests).toHaveLength(2)
    expect(JSON.parse(tutor.requests[0] as string)).toMatchObject({ misses: 2, maxTurns: 2 })
  })

  it('shows the worked steps and offers a new question when turns run out', async () => {
    const tutor = tutorBuddy(Array.from({ length: 5 }, () => ({ calls: [{ name: 'getMistakeHistory' }] })))
    const open = await escalate(tutor)
    const check = firstQuestion(lesson.ideas[0])
    await screen.findByText('Here is how to solve it:')
    expect(screen.getByText(check.steps[check.steps.length - 1])).toBeTruthy()
    expect(tutor.requests).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'Try a new question' }))
    expect(screen.queryByText('☁️ Tutor')).toBeNull()
    expect(screen.queryByText(check.prompt)).toBeNull()
    const sessions = (await saved(open)).progress.tutorSessions
    expect(sessions.map((s) => s.outcome)).toEqual(['out_of_turns'])
    expect(sessions[0].calls.at(-1)).toEqual({ name: 'giveWorkedSolution', args: { questionId: 'check' }, by: 'app' })
  })

  it('says the tutor is busy while it waits to retry', async () => {
    const tutor = tutorBuddy([new Error('[503 ] This model is currently experiencing high demand.')])
    await escalate(tutor)
    expect(await screen.findByText('Tutor is busy, trying again…')).toBeTruthy()
  })

  it('falls back to "Show me how" when the tutor fails or Firebase is resting', async () => {
    const tutor = tutorBuddy([new Error('[400 ] bad request')])
    await escalate(tutor)
    expect(await screen.findByText("The tutor can't help right now")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show me how' })).toBeTruthy()
    cleanup()

    await start(dbOpener())
    await act(async () => {})
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    for (let i = 0; i < MISSES_BEFORE_HELP; i++) type('999999', 'cm')
    expect(screen.getByText("The tutor can't help right now")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show me how' })).toBeTruthy()
  })
})

describe('Tutor gates and navigation', () => {
  it('never calls the cloud tutor in only_on_device mode and falls back to "Show me how"', async () => {
    const tutor = tutorBuddy([{ calls: [{ name: 'getMistakeHistory' }] }], 'only_on_device')
    await escalate(tutor)
    expect(await screen.findByText("The tutor can't help right now")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show me how' })).toBeTruthy()
    await act(async () => {})
    expect(tutor.requests).toHaveLength(0)
  })

  it('offers "Ask the Tutor again" on a question that already had a tutor session', async () => {
    const open = dbOpener()
    const idea = lesson.ideas[0]
    const q = firstQuestion(idea)
    let profile = newProfile('Riya', 'riya', lesson, 0)
    for (let i = 0; i < MISSES_BEFORE_HELP; i++) {
      const input = { text: '999999', unit: q.answer.unit }
      profile = { ...profile, progress: recordAttempt(profile.progress, idea, input, grade(q, input), i) }
    }
    profile.progress.tutorSessions = [{ ideaId: idea.id, seed: q.seed, startedAt: 0, calls: [], results: [], outcome: 'failed' }]
    await (await open()).addProfile(profile)

    const tutor = tutorBuddy(['hang'])
    await start(open, lessonJson, tutor.service)
    await screen.findByText('Idea 1 of 7')
    fireEvent.click(screen.getByRole('button', { name: 'Ask the Tutor again' }))
    expect(screen.getByText('☁️ Tutor')).toBeTruthy()
    await vi.waitFor(() => expect(tutor.requests).toHaveLength(1))
  })

  it('offers "Ask the Tutor" after a reload with enough misses and only starts when asked', async () => {
    const open = dbOpener()
    const idea = lesson.ideas[0]
    const q = firstQuestion(idea)
    let profile = newProfile('Riya', 'riya', lesson, 0)
    for (let i = 0; i < MISSES_BEFORE_HELP; i++) {
      const input = { text: '999999', unit: q.answer.unit }
      profile = { ...profile, progress: recordAttempt(profile.progress, idea, input, grade(q, input), i) }
    }
    await (await open()).addProfile(profile)

    const tutor = tutorBuddy(['hang'])
    await start(open, lessonJson, tutor.service)
    await act(async () => {})
    await screen.findByText('Idea 1 of 7')
    expect(screen.getByRole('button', { name: 'Show me how' })).toBeTruthy()
    await act(async () => {})
    expect(tutor.requests).toHaveLength(0)
    expect(screen.queryByText('☁️ Tutor')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Ask the Tutor' }))
    expect(screen.getByText('☁️ Tutor')).toBeTruthy()
    await vi.waitFor(() => expect(tutor.requests).toHaveLength(1))
    expect(screen.queryByRole('button', { name: 'Ask the Tutor' })).toBeNull()
  })

  it('refuses navigate next before the idea is passed, and navigate back moves to the previous idea', async () => {
    const tutor = tutorBuddy([
      { calls: [{ name: 'navigate', args: { direction: 'next' } }] },
      { calls: [{ name: 'navigate', args: { direction: 'back' } }] },
    ])
    const open = dbOpener()
    await start(open, lessonJson, tutor.service)
    await act(async () => {})
    await learnIdea2()
    for (let i = 0; i < MISSES_BEFORE_HELP; i++) type('999999', 'cm')
    await screen.findByText('Idea 1 of 7')
    expect(JSON.stringify(tutor.requests[1])).toContain('not passed')
    const sessions = (await saved(open)).progress.tutorSessions
    expect(sessions).toEqual([
      expect.objectContaining({
        ideaId: 'idea-2',
        outcome: 'navigated',
        calls: [
          { name: 'navigate', args: { direction: 'next' }, by: 'model' },
          { name: 'navigate', args: { direction: 'back' }, by: 'model' },
        ],
      }),
    ])
  })
})

describe('Weak-spot test', () => {
  let clock = 1_000_000
  const now = () => clock
  const random = () => {
    const rng = createRng(++n)
    return () => rng.int(0, 999_999_999) / 1_000_000_000
  }

  async function startTestApp(open: () => Promise<Store>, buddy: BuddyService = restingBuddy()) {
    render(<LearnerApp open={open} lessonData={lessonJson} buddy={buddy} now={now} random={random()} />)
    await loaded()
  }

  async function openTest(open: () => Promise<Store>) {
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Begin' }))
    await screen.findByText('Question 1 of 10')
    return (await saved(open)).progress.tests[0]
  }

  const shownIndex = () => Number(/Question (\d+) of 10/.exec(document.body.textContent ?? '')?.[1]) - 1

  function answerRight(test: TestRecord) {
    const q = testQuestion(test.questions[shownIndex()])
    type(String(q.answer.value), q.answer.unit, 'Save answer')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs a test with no marking, then shows corrections, steps and a Buddy "Why?" with its badge', async () => {
    clock = 1_000_000
    const buddy = fakeBuddy()
    const open = dbOpener()
    await startTestApp(open, buddy.service)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    const test = await openTest(open)
    expect(test.startedAt).toBe(clock)
    expect(screen.getByRole('timer').textContent).toBe('20:00 left')
    expect(screen.getByRole('timer').getAttribute('aria-live')).toBe('off')
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()

    const first = testQuestion(test.questions[0])
    const wrong = first.answer.value + 1
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
    type(String(wrong), first.answer.unit === 'S$' ? null : first.answer.unit, 'Save answer')
    expect(status()).not.toContain('Not quite')
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Question 2 of 10')
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await screen.findByText('Question 3 of 10')
    for (let i = 2; i < 10; i++) answerRight(test)

    await screen.findByText('Test results')
    expect(screen.getByText('8 out of 10')).toBeTruthy()
    const card1 = within(screen.getByRole('listitem', { name: 'Question 1' }))
    expect(card1.getByText('✘')).toBeTruthy()
    expect(card1.getByText('Not quite. Look at the example again')).toBeTruthy()
    expect(card1.getByText(formatAnswer(first.answer))).toBeTruthy()
    expect(card1.getByText(first.steps[first.steps.length - 1])).toBeTruthy()
    const card2 = within(screen.getByRole('listitem', { name: 'Question 2' }))
    expect(card2.getByText('No answer given')).toBeTruthy()
    expect(card2.getByText(formatAnswer(testQuestion(test.questions[1]).answer))).toBeTruthy()
    expect(within(screen.getByRole('listitem', { name: 'Question 3' })).getByText('✔')).toBeTruthy()

    fireEvent.click(card1.getByRole('button', { name: 'Why?' }))
    await buddy.reply({ text: json('answer_attempt', null, 'Count every side once.'), source: 'in_cloud' })
    expect(card1.getByText('Count every side once.')).toBeTruthy()
    expect(card1.getByText('☁️ Cloud')).toBeTruthy()

    const p = (await saved(open)).progress
    expect(p.tests[0].finishedAt).not.toBeNull()
    expect(p.tests[0].answers[1]).toBeNull()
    expect(p.tests[0].results[1]).toEqual({ correct: false, reason: 'blank', code: null })
    expect(p.buddyTurns).toEqual([expect.objectContaining({ ideaId: test.questions[0].ideaId, kind: 'miss', source: 'in_cloud' })])

    fireEvent.click(screen.getAllByRole('button', { name: 'Back to lesson' })[0])
    await screen.findByText('Idea 1 of 7')
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(within(await screen.findByRole('list', { name: 'Your last tests' })).getByText(/8 out of 10 on/)).toBeTruthy()
  })

  it('resumes on the next unanswered question after a reload with the timer continuing', async () => {
    clock = 1_000_000
    const open = dbOpener()
    await startTestApp(open)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    const test = await openTest(open)
    for (let i = 0; i < 3; i++) answerRight(test)
    await screen.findByText('Question 4 of 10')
    await act(async () => {})
    cleanup()

    clock += 65_000
    await startTestApp(open)
    await screen.findByText('Question 4 of 10')
    expect(screen.getByRole('timer').textContent).toBe('18:55 left')
    expect(screen.getByRole('button', { name: 'Back to lesson' })).toBeTruthy()
  })

  it('ends the test when time runs out and marks the rest blank', async () => {
    clock = 1_000_000
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const open = dbOpener()
    await startTestApp(open)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    const test = await openTest(open)
    for (let i = 0; i < 5; i++) answerRight(test)
    await screen.findByText('Question 6 of 10')

    clock = test.startedAt + test.timeLimitS * 1000 - 30_000
    await act(async () => vi.advanceTimersByTime(1000))
    expect(screen.getByText('One minute left')).toBeTruthy()
    clock = test.startedAt + test.timeLimitS * 1000
    await act(async () => vi.advanceTimersByTime(1000))
    await screen.findByText('Test results')
    expect(screen.getByText('5 out of 10')).toBeTruthy()
    const results = (await saved(open)).progress.tests[0].results
    expect(results.slice(5).every((r) => r?.reason === 'blank')).toBe(true)
  })

  it('finishes and marks a test on load when the time ran out while closed', async () => {
    clock = 1_000_000
    const open = dbOpener()
    await startTestApp(open)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    const test = await openTest(open)
    answerRight(test)
    await screen.findByText('Question 2 of 10')
    await act(async () => {})
    cleanup()

    clock = test.startedAt + test.timeLimitS * 1000 + 1
    await startTestApp(open)
    await screen.findByText('Test results')
    expect(screen.getByText('1 out of 10')).toBeTruthy()
    expect((await saved(open)).progress.tests[0].finishedAt).toBe(clock)
  })

  it('keeps the steps when Buddy is resting and the "Why?" fails', async () => {
    clock = 1_000_000
    const open = dbOpener()
    await startTestApp(open)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    await openTest(open)
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await screen.findByText('Test results')
    expect(screen.getByText('0 out of 10')).toBeTruthy()
    const card1 = within(screen.getByRole('listitem', { name: 'Question 1' }))
    fireEvent.click(card1.getByRole('button', { name: 'Why?' }))
    expect(await card1.findByText('Buddy is resting right now')).toBeTruthy()
    expect(card1.getByRole('list')).toBeTruthy()
  })

  it('lets the learner leave a test and resume it from the Complete screen', async () => {
    clock = 1_000_000
    const open = dbOpener()
    let profile = newProfile('Riya', 'riya', lesson, 0)
    profile = { ...profile, progress: { ...profile.progress, currentIdeaId: null, passedIdeaIds: lesson.ideas.map((i) => i.id) } }
    await (await open()).addProfile(profile)
    await startTestApp(open)
    await screen.findByText('Chapter complete')
    fireEvent.click(screen.getByRole('button', { name: 'Take the test' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Begin' }))
    await screen.findByText('Question 1 of 10')
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to lesson' }))
    await screen.findByText('Chapter complete')
    fireEvent.click(screen.getByRole('button', { name: 'Take the test' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    await screen.findByText('Question 2 of 10')
    expect((await saved(open)).progress.tests).toHaveLength(1)
  })

  it('shows the corrections when Test finishes a test that ran out while in the lesson', async () => {
    clock = 1_000_000
    const open = dbOpener()
    await startTestApp(open)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('You have 20:00 for the whole test. The clock starts when you press Begin.')).toBeTruthy()
    expect(screen.getByText(/skip or don't reach before time runs out count as wrong/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }))
    const test = (await saved(open)).progress.tests[0]
    answerRight(test)
    await screen.findByText('Question 2 of 10')
    fireEvent.click(screen.getByRole('button', { name: 'Back to lesson' }))
    await screen.findByText('Idea 1 of 7')
    expect(screen.getByRole('button', { name: 'Resume test' })).toBeTruthy()

    clock = test.startedAt + test.timeLimitS * 1000 + 1
    fireEvent.click(screen.getByRole('button', { name: 'Resume test' }))
    await screen.findByText('Test results')
    expect(screen.getByText('1 out of 10')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Back to lesson' })[0])
    await screen.findByText('Idea 1 of 7')
    expect(screen.getByRole('button', { name: 'Test' })).toBeTruthy()
  })

  it('shows "Why?" again after a failed reply so the learner can retry', async () => {
    clock = 1_000_000
    const buddy = fakeBuddy()
    const open = dbOpener()
    await startTestApp(open, buddy.service)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    await openTest(open)
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await screen.findByText('Test results')
    const card1 = within(screen.getByRole('listitem', { name: 'Question 1' }))
    expect(card1.getByText('Wrong')).toBeTruthy()
    fireEvent.click(card1.getByRole('button', { name: 'Why?' }))
    await buddy.reply(new Error('offline'))
    expect(card1.getByText('Buddy is resting right now')).toBeTruthy()
    fireEvent.click(card1.getByRole('button', { name: 'Why?' }))
    await buddy.reply({ text: json('answer_attempt', null, 'Try adding every side.'), source: 'on_device' })
    expect(card1.getByText('Try adding every side.')).toBeTruthy()
    expect(card1.queryByRole('button', { name: 'Why?' })).toBeNull()
    expect(buddy.prompts[0]).toContain('(no unit)')
  })

  it('lists a finished test score on the Complete screen', async () => {
    clock = 1_000_000
    const open = dbOpener()
    let profile = newProfile('Riya', 'riya', lesson, 0)
    profile = { ...profile, progress: { ...profile.progress, currentIdeaId: null, passedIdeaIds: lesson.ideas.map((i) => i.id) } }
    await (await open()).addProfile(profile)
    await startTestApp(open)
    fireEvent.click(await screen.findByRole('button', { name: 'Take the test' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Begin' }))
    await screen.findByText('Question 1 of 10')
    const test = (await saved(open)).progress.tests[0]
    answerRight(test)
    for (let i = 1; i < 10; i++) fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await screen.findByText('Test results')
    fireEvent.click(screen.getAllByRole('button', { name: 'Back to lesson' })[0])
    await screen.findByText('Chapter complete')
    expect(within(screen.getByRole('list', { name: 'Your last tests' })).getByText(/^1 out of 10 on/)).toBeTruthy()
  })

  it('enables the header Test button again once the tutor session ends', async () => {
    const tutor = tutorBuddy([new Error('[400 ] bad request')])
    await escalate(tutor)
    expect(await screen.findByText("The tutor can't help right now")).toBeTruthy()
    await vi.waitFor(() => expect((screen.getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('disables the header Test button while a tutor session runs', async () => {
    const tutor = tutorBuddy(['hang'])
    await escalate(tutor)
    await vi.waitFor(() => expect(tutor.requests).toHaveLength(1))
    expect((screen.getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Tuning', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows "Show me how" after the tuned number of misses', async () => {
    const buddy = fakeBuddy({ tuning: { misses_before_help: 2 } })
    await startWith(buddy)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    type('999999', 'cm')
    expect(screen.queryByRole('button', { name: 'Show me how' })).toBeNull()
    type('999999', 'cm')
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Show me how' })).toBeTruthy()
  })

  it('applies a threshold that arrives mid-question from the next question', async () => {
    let ready!: () => void
    const buddy = fakeBuddy({ tuning: { misses_before_help: 4 }, load: new Promise<void>((r) => (ready = r)) })
    await start(dbOpener(), lessonJson, buddy.service)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    await act(async () => ready())
    expect(buddy.service.tuning().misses_before_help).toBe(4)
    type('999999', 'cm')
    type('999999', 'cm')
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Show me how' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try a new question' }))
    for (let i = 0; i < 3; i++) type('999999', 'cm')
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Show me how' })).toBeNull()
    type('999999', 'cm')
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Show me how' })).toBeTruthy()
  })

  it('uses the tuned seconds for a new test', async () => {
    const buddy = fakeBuddy({ tuning: { test_seconds_easy: 60, test_seconds_medium: 60, test_seconds_hard: 60 } })
    const open = await startWith(buddy)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText(/You have 10:00 for the whole test/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }))
    await screen.findByText('Question 1 of 10')
    expect(screen.getByRole('timer').textContent).toBe('10:00 left')
    expect((await saved(open)).progress.tests[0].timeLimitS).toBe(600)
  })

  it('reads the idea card aloud and shows Stop, with no speaker buttons when speech is missing', async () => {
    const spoken: string[] = []
    vi.stubGlobal('speechSynthesis', {
      speak: (u: { text: string }) => spoken.push(u.text),
      cancel: () => {},
      getVoices: () => [],
    })
    vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(t: string) { this.text = t } })
    await start(dbOpener())
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    const idea = lesson.ideas[0]
    const button = screen.getByRole('button', { name: 'Read the idea aloud' })
    fireEvent.click(button)
    expect(spoken[0]).toContain(idea.title)
    expect(spoken.join(' ')).toContain(idea.keyPoints[0].slice(0, 10))
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('false')
    cleanup()

    vi.unstubAllGlobals()
    await start(dbOpener())
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    expect(screen.queryByRole('button', { name: /aloud/ })).toBeNull()
  })

  it("stops reading a test question when moving to the next one, and offers to read Buddy's clue", async () => {
    let cancels = 0
    vi.stubGlobal('speechSynthesis', { speak: () => {}, cancel: () => cancels++, getVoices: () => [] })
    vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(t: string) { this.text = t } })
    const buddy = fakeBuddy()
    await startWith(buddy)
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    type('999999', 'cm')
    await buddy.reply({ text: json('answer_attempt', null, 'Count every side once.'), source: 'on_device' })
    expect(screen.getByRole('button', { name: "Read Buddy's clue aloud" })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Begin' }))
    await screen.findByText('Question 1 of 10')
    fireEvent.click(screen.getByRole('button', { name: 'Read the question aloud' }))
    expect(screen.getByRole('button', { name: 'Read the question aloud' }).getAttribute('aria-pressed')).toBe('true')
    const before = cancels
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await screen.findByText('Question 2 of 10')
    expect(cancels).toBe(before + 1)
    expect(screen.getByRole('button', { name: 'Read the question aloud' }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('For parents', () => {
  async function withMistakes(open: () => Promise<Store>) {
    const p = newProfile('Zanzibar', 'zanzibar', lesson, 0)
    const attempt = { ideaId: 'idea-1', templateId: 'perim_rectangle', difficulty: 'medium' as const, seed: 1, answerText: '1', unit: 'cm' as const, correct: false, reason: 'wrong_number' as const, at: 1 }
    p.progress.attempts = [
      { ...attempt, code: 'perim_two_sides_only' },
      { ...attempt, code: 'perim_two_sides_only' },
      { ...attempt, code: 'units_missing' },
    ]
    await (await open()).addProfile(p)
  }

  async function openPanel() {
    await screen.findByText('Idea 1 of 7')
    fireEvent.click(screen.getByRole('button', { name: 'For parents' }))
    return within(screen.getByRole('region', { name: 'For parents' }))
  }

  it('says there are no mistakes for a new learner', async () => {
    await start(dbOpener())
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    fireEvent.click(screen.getByRole('button', { name: 'For parents' }))
    const panel = within(screen.getByRole('region', { name: 'For parents' }))
    expect(panel.getByText('No mistakes recorded yet.')).toBeTruthy()
    expect(panel.getByText('Ideas passed: 0 of 7')).toBeTruthy()
  })

  it('shows recent answers newest first, with the question, the answer and what went wrong', async () => {
    const open = dbOpener()
    await withMistakes(open)
    await startWith(fakeBuddy(), open)
    const panel = await openPanel()
    const items = within(panel.getByRole('list', { name: 'Recent answers' })).getAllByRole('listitem')
    const prompt = generate('perim_rectangle', 'medium', 1).prompt
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toBe(`${answeredAt(1)}${prompt}Answer: 1 cm✘ Forgets to write the units`)
    expect(items[1].textContent).toContain('✘ Adds only two sides when finding perimeter')
  })

  it('counts wrong answers that have no named mistake instead of saying there are none', async () => {
    await start(dbOpener())
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    type('999999', 'cm')
    type('999999', 'cm')
    fireEvent.click(screen.getByRole('button', { name: 'For parents' }))
    const panel = within(screen.getByRole('region', { name: 'For parents' }))
    expect(panel.getByText('2 wrong answers so far, but no common kind of mistake yet. See Recent answers below.')).toBeTruthy()
  })

  it('shows the parents page instead of the lesson, and the lesson comes back on Close', async () => {
    await start(dbOpener())
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    fireEvent.click(screen.getByRole('button', { name: 'For parents' }))
    expect(screen.queryByRole('button', { name: 'Check my answer' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'Check my answer' })).toBeTruthy()
  })

  it('shows 10 answers and 20 more at a time', async () => {
    const open = dbOpener()
    const p = newProfile('Riya', 'riya', lesson, 0)
    const attempt = { ideaId: 'idea-1', templateId: 'perim_rectangle', difficulty: 'medium' as const, seed: 1, answerText: '1', unit: 'cm' as const, correct: false, reason: 'wrong_number' as const, code: null, at: 1 }
    p.progress.attempts = Array.from({ length: 35 }, (_, i) => ({ ...attempt, at: i }))
    await (await open()).addProfile(p)
    await start(open)
    const panel = await openPanel()
    const count = () => within(panel.getByRole('list', { name: 'Recent answers' })).getAllByRole('listitem').length
    expect(count()).toBe(10)
    fireEvent.click(panel.getByRole('button', { name: 'Show 20 more' }))
    expect(count()).toBe(30)
    fireEvent.click(panel.getByRole('button', { name: 'Show 5 more' }))
    expect(count()).toBe(35)
    expect(panel.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull()
  })

  it('lists finished tests with their score, questions, answers and results', async () => {
    const open = dbOpener()
    const p = newProfile('Riya', 'riya', lesson, 0)
    const refs = [
      { templateId: 'perim_rectangle', difficulty: 'medium' as const, seed: 1, ideaId: 'idea-1' },
      { templateId: 'perim_rectangle', difficulty: 'medium' as const, seed: 2, ideaId: 'idea-1' },
    ]
    const right = testQuestion(refs[0]).answer
    p.progress.tests = [
      {
        id: 't1',
        startedAt: 0,
        finishedAt: 5000,
        timeLimitS: 240,
        questions: refs,
        answers: [{ text: String(right.value), unit: right.unit }, null],
        results: [{ correct: true, reason: null, code: null }, { correct: false, reason: 'blank', code: null }],
      },
    ]
    await (await open()).addProfile(p)
    await start(open)
    const panel = await openPanel()
    expect(panel.getByText(`${answeredAt(5000)}: 1 out of 2`)).toBeTruthy()
    const items = within(panel.getByRole('list', { name: `Test on ${answeredAt(5000)}` })).getAllByRole('listitem')
    expect(items[0].textContent).toContain(testQuestion(refs[0]).prompt)
    expect(items[0].textContent).toContain('✔ Right')
    expect(items[1].textContent).toContain('Answer: (blank)✘ Left blank')
  })

  it('says there are no tests or answers yet for a new learner', async () => {
    await start(dbOpener())
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    fireEvent.click(screen.getByRole('button', { name: 'For parents' }))
    const panel = within(screen.getByRole('region', { name: 'For parents' }))
    expect(panel.getByText('No answers yet.')).toBeTruthy()
    expect(panel.getByText('No tests finished yet.')).toBeTruthy()
  })

  it('lists the mistakes and a 🔒 paragraph written on-device from codes and counts only', async () => {
    const buddy = fakeBuddy({ summary: async () => 'Your child sometimes adds only two sides.' })
    const open = dbOpener()
    await withMistakes(open)
    await startWith(buddy, open)
    const panel = await openPanel()
    expect(panel.getByText('Adds only two sides when finding perimeter (2 times)')).toBeTruthy()
    expect(panel.getByText('Forgets to write the units (1 time)')).toBeTruthy()
    expect(await panel.findByText('Your child sometimes adds only two sides.')).toBeTruthy()
    expect(panel.getByText('🔒 Written on this device')).toBeTruthy()
    expect(buddy.createSummaryModel).toHaveBeenCalledTimes(1)
    expect(buddy.summaryPrompts[0]).not.toContain('Zanzibar')
  })

  it('shows only the list and the note in cloud mode, without building a summary model', async () => {
    const buddy = fakeBuddy({ mode: 'only_in_cloud', summary: async () => 'never' })
    const open = dbOpener()
    await withMistakes(open)
    await startWith(buddy, open)
    const panel = await openPanel()
    expect(panel.getByText('Adds only two sides when finding perimeter (2 times)')).toBeTruthy()
    expect(panel.getByText('A written summary needs on-device AI in Chrome.')).toBeTruthy()
    await act(async () => {})
    expect(buddy.createSummaryModel).not.toHaveBeenCalled()
    expect(buddy.prompts).toEqual([])
  })

  it('says the summary failed when the on-device model fails', async () => {
    const buddy = fakeBuddy({ summary: async () => 'x'.repeat(401) })
    const open = dbOpener()
    await withMistakes(open)
    await startWith(buddy, open)
    const panel = await openPanel()
    expect(await panel.findByText("Couldn't write a summary this time.")).toBeTruthy()
    expect(panel.queryByText('A written summary needs on-device AI in Chrome.')).toBeNull()
    expect(panel.queryByText('🔒 Written on this device')).toBeNull()
  })

  it('focuses the heading on open and the button on close', async () => {
    await start(dbOpener())
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    const button = screen.getByRole('button', { name: 'For parents' })
    fireEvent.click(button)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'For parents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'For parents' })).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('writes the paragraph once Buddy becomes ready after the panel opened', async () => {
    let ready!: () => void
    const buddy = fakeBuddy({ summary: async () => 'Ready now.', load: new Promise<void>((r) => (ready = r)) })
    const open = dbOpener()
    await withMistakes(open)
    await start(open, lessonJson, buddy.service)
    const panel = await openPanel()
    expect(panel.getByText('A written summary needs on-device AI in Chrome.')).toBeTruthy()
    await act(async () => ready())
    expect(await panel.findByText('Ready now.')).toBeTruthy()
    expect(buddy.createSummaryModel).toHaveBeenCalledTimes(1)
  })

  it('writes a new paragraph after new mistakes', async () => {
    let n = 0
    const buddy = fakeBuddy({ summary: async () => `Summary ${++n}.` })
    const open = dbOpener()
    await withMistakes(open)
    await startWith(buddy, open)
    expect(await (await openPanel()).findByText('Summary 1.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    const q = firstQuestion(lesson.ideas[0])
    type(String(q.mistakes[0].value), q.answer.unit)
    fireEvent.click(screen.getByRole('button', { name: 'For parents' }))
    const panel = within(screen.getByRole('region', { name: 'For parents' }))
    expect(await panel.findByText('Summary 2.')).toBeTruthy()
    expect(buddy.summaryPrompts).toHaveLength(2)
    expect(buddy.summaryPrompts[1]).not.toBe(buddy.summaryPrompts[0])
  })
})

describe('Keep progress and delete data', () => {
  afterEach(() => vi.restoreAllMocks())

  function fakeAccount(status: AccountStatus | Error, failSignIn = false) {
    const signIn = vi.fn(() => (failSignIn ? Promise.reject(new Error('popup closed')) : Promise.resolve()))
    const signOut = vi.fn(async () => {})
    const service: AccountService = {
      status: () => (status instanceof Error ? Promise.reject(status) : Promise.resolve(status)),
      signIn,
      signOut,
    }
    return { service, signIn, signOut }
  }

  async function openGrownUps(account: AccountService, open = dbOpener()) {
    render(<LearnerApp open={open} lessonData={lessonJson} buddy={restingBuddy()} account={account} />)
    await screen.findByText("Who's learning?")
    await addNickname('Riya')
    await screen.findByText('Idea 1 of 7')
    fireEvent.click(screen.getByRole('button', { name: 'For parents' }))
    return within(screen.getByRole('region', { name: 'For parents' }))
  }

  it('offers Google sign-in when the browser is anonymous', async () => {
    const account = fakeAccount({ signedIn: false })
    const panel = await openGrownUps(account.service)
    fireEvent.click(await panel.findByRole('button', { name: 'Sign in with Google' }))
    expect(account.signIn).toHaveBeenCalledTimes(1)
    expect(panel.getByText('One moment…')).toBeTruthy()
  })

  it('says where progress is saved and offers sign-out when signed in', async () => {
    const account = fakeAccount({ signedIn: true, email: 'parent@example.com' })
    const panel = await openGrownUps(account.service)
    expect(await panel.findByText('Progress is saved to parent@example.com.')).toBeTruthy()
    fireEvent.click(panel.getByRole('button', { name: 'Sign out' }))
    expect(account.signOut).toHaveBeenCalledTimes(1)
  })

  it('shows a message when sign-in fails', async () => {
    const account = fakeAccount({ signedIn: false }, true)
    const panel = await openGrownUps(account.service)
    fireEvent.click(await panel.findByRole('button', { name: 'Sign in with Google' }))
    expect(await panel.findByText("Sign-in didn't work. Reload the page and try again.")).toBeTruthy()
  })

  it('offers Google sign-in on the start screen before any nickname exists', async () => {
    const account = fakeAccount({ signedIn: false })
    render(<LearnerApp open={dbOpener()} lessonData={lessonJson} buddy={restingBuddy()} account={account.service} />)
    await screen.findByText("Who's learning?")
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }))
    expect(account.signIn).toHaveBeenCalledTimes(1)
  })

  it('hides the sign-in section when the account cannot be read', async () => {
    const panel = await openGrownUps(fakeAccount(new Error('offline')).service)
    await act(async () => {})
    expect(panel.queryByText('Keep progress')).toBeNull()
  })

  it('deletes the learner after confirming and returns to the nickname screen', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const open = dbOpener()
    const panel = await openGrownUps(fakeAccount({ signedIn: false }).service, open)
    fireEvent.click(panel.getByRole('button', { name: "Delete Riya's data" }))
    expect(confirm).toHaveBeenCalledWith("Delete all of Riya's progress? This can't be undone.")
    await screen.findByLabelText('Add a nickname')
    expect(screen.queryByRole('button', { name: 'Riya' })).toBeNull()
    expect(await (await open()).listProfiles()).toEqual([])
  })

  it('keeps the learner when the grown-up cancels', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const open = dbOpener()
    const panel = await openGrownUps(fakeAccount({ signedIn: false }).service, open)
    fireEvent.click(panel.getByRole('button', { name: "Delete Riya's data" }))
    expect(screen.getByText('Idea 1 of 7')).toBeTruthy()
    expect(await (await open()).listProfiles()).toHaveLength(1)
  })
})
