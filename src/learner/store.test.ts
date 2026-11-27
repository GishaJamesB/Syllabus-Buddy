import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import lessonJson from '../content/ch6.lesson.json'
import type { Lesson } from '../content/lessonSchema'
import { goTo, newProfile } from './progress'
import { memoryStore, NicknameTakenError, openStore } from './store'

const lesson = lessonJson as Lesson
let n = 0
const freshDb = () => openStore(`test-db-${++n}`)

describe('store', () => {
  it('adds, lists, loads and saves profiles in IndexedDB', async () => {
    const store = await freshDb()
    expect(store.persistent).toBe(true)
    expect(await store.listProfiles()).toEqual([])
    const riya = newProfile('Riya', 'riya', lesson, 1)
    await store.addProfile(riya)
    await store.saveProfile({ ...riya, progress: goTo(riya.progress, 'idea-4', 2) })
    expect((await store.loadProfile('riya'))?.progress.currentIdeaId).toBe('idea-4')
    expect((await store.listProfiles()).map((p) => p.nickname)).toEqual(['Riya'])
  })

  it('deletes a profile in IndexedDB and in memory', async () => {
    for (const store of [await freshDb(), memoryStore()]) {
      await store.addProfile(newProfile('Riya', 'riya', lesson, 1))
      await store.deleteProfile('riya')
      expect(await store.loadProfile('riya')).toBeNull()
      expect(await store.listProfiles()).toEqual([])
    }
  })

  it('persists across reopening the same database', async () => {
    const name = `test-db-${++n}`
    const first = await openStore(name)
    await first.addProfile(newProfile('Riya', 'riya', lesson, 1))
    const second = await openStore(name)
    expect(await second.loadProfile('riya')).not.toBeNull()
  })

  it('rejects a duplicate id', async () => {
    const store = await freshDb()
    await store.addProfile(newProfile('Riya', 'riya', lesson, 1))
    await expect(store.addProfile(newProfile('RIYA', 'riya', lesson, 2))).rejects.toBeInstanceOf(NicknameTakenError)
    const mem = memoryStore()
    await mem.addProfile(newProfile('Riya', 'riya', lesson, 1))
    await expect(mem.addProfile(newProfile('riya', 'riya', lesson, 2))).rejects.toBeInstanceOf(NicknameTakenError)
  })

  it('falls back to memory when IndexedDB fails to open', async () => {
    const original = indexedDB.open
    indexedDB.open = () => {
      throw new DOMException('blocked', 'InvalidStateError')
    }
    try {
      const store = await openStore(`test-db-${++n}`)
      expect(store.persistent).toBe(false)
      await store.addProfile(newProfile('Riya', 'riya', lesson, 1))
      expect(await store.loadProfile('riya')).not.toBeNull()
    } finally {
      indexedDB.open = original
    }
  })
})
