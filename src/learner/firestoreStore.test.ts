import { beforeEach, describe, expect, it, vi } from 'vitest'
import lessonJson from '../content/ch6.lesson.json'
import type { Lesson } from '../content/lessonSchema'
import { goTo, newProfile } from './progress'

const docs = new Map<string, unknown>()

interface Ref {
  path: string
}

const snapshot = (ref: Ref) => ({ exists: () => docs.has(ref.path), data: () => structuredClone(docs.get(ref.path)) })

vi.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  doc: (parent: Ref, id: string) => ({ path: `${parent.path}/${id}` }),
  getDoc: async (ref: Ref) => snapshot(ref),
  getDocs: async (ref: Ref) => ({
    docs: [...docs.keys()].filter((k) => k.startsWith(`${ref.path}/`)).map((k) => snapshot({ path: k })),
  }),
  setDoc: async (ref: Ref, data: unknown) => {
    docs.set(ref.path, structuredClone(data))
  },
}))

const { firestoreStore } = await import('./firestoreStore')
const { NicknameTakenError } = await import('./store')

const lesson = lessonJson as Lesson
const db = {} as never

beforeEach(() => docs.clear())

describe('firestoreStore', () => {
  it('is persistent and stores profiles under the user', async () => {
    const store = firestoreStore(db, 'u1')
    expect(store.persistent).toBe(true)
    await store.addProfile(newProfile('Riya', 'riya', lesson, 1))
    expect([...docs.keys()]).toEqual(['users/u1/profiles/riya'])
  })

  it('adds then loads a profile, and returns null for a missing one', async () => {
    const store = firestoreStore(db, 'u1')
    const riya = newProfile('Riya', 'riya', lesson, 1)
    await store.addProfile(riya)
    expect(await store.loadProfile('riya')).toEqual(riya)
    expect(await store.loadProfile('nobody')).toBeNull()
  })

  it('throws NicknameTakenError when the profile already exists', async () => {
    const store = firestoreStore(db, 'u1')
    await store.addProfile(newProfile('Riya', 'riya', lesson, 1))
    await expect(store.addProfile(newProfile('Riya', 'riya', lesson, 2))).rejects.toBeInstanceOf(NicknameTakenError)
  })

  it('overwrites a profile on save', async () => {
    const store = firestoreStore(db, 'u1')
    const riya = newProfile('Riya', 'riya', lesson, 1)
    await store.addProfile(riya)
    await store.saveProfile({ ...riya, progress: goTo(riya.progress, 'idea-4', 2) })
    expect((await store.loadProfile('riya'))?.progress.currentIdeaId).toBe('idea-4')
  })

  it('lists the most recently updated profile first and only the current user', async () => {
    const store = firestoreStore(db, 'u1')
    await store.addProfile(newProfile('Riya', 'riya', lesson, 1))
    await store.addProfile(newProfile('Sam', 'sam', lesson, 5))
    await firestoreStore(db, 'u2').addProfile(newProfile('Other', 'other', lesson, 9))
    expect((await store.listProfiles()).map((p) => p.nickname)).toEqual(['Sam', 'Riya'])
  })
})
