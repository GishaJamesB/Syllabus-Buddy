import { openDB, type IDBPDatabase } from 'idb'
import type { Profile } from './progress'

export interface Store {
  persistent: boolean
  listProfiles(): Promise<Profile[]>
  addProfile(profile: Profile): Promise<void>
  loadProfile(id: string): Promise<Profile | null>
  saveProfile(profile: Profile): Promise<void>
  deleteProfile(id: string): Promise<void>
}

const DB_NAME = 'syllabus-buddy'
const STORE = 'profiles'
const OPEN_TIMEOUT_MS = 3000

export const byRecent =(a: Profile, b: Profile) => (b.progress?.updatedAt ?? 0) - (a.progress?.updatedAt ?? 0)

export class NicknameTakenError extends Error {
  constructor() {
    super('That nickname is taken on this device')
  }
}

export function memoryStore(): Store {
  const profiles = new Map<string, Profile>()
  return {
    persistent: false,
    async listProfiles() {
      return [...profiles.values()].map((p) => structuredClone(p)).sort(byRecent)
    },
    async addProfile(profile) {
      if (profiles.has(profile.id)) throw new NicknameTakenError()
      profiles.set(profile.id, structuredClone(profile))
    },
    async loadProfile(id) {
      const p = profiles.get(id)
      return p ? structuredClone(p) : null
    },
    async saveProfile(profile) {
      profiles.set(profile.id, structuredClone(profile))
    },
    async deleteProfile(id) {
      profiles.delete(id)
    },
  }
}

function idbStore(db: IDBPDatabase): Store {
  return {
    persistent: true,
    async listProfiles() {
      return ((await db.getAll(STORE)) as Profile[]).sort(byRecent)
    },
    async addProfile(profile) {
      try {
        await db.add(STORE, profile)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'ConstraintError') throw new NicknameTakenError()
        throw e
      }
    },
    async loadProfile(id) {
      return ((await db.get(STORE, id)) as Profile | undefined) ?? null
    },
    async saveProfile(profile) {
      await db.put(STORE, profile)
    },
    async deleteProfile(id) {
      await db.delete(STORE, id)
    },
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Opening storage timed out')), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

export async function openStore(dbName = DB_NAME): Promise<Store> {
  try {
    if (typeof indexedDB === 'undefined') return memoryStore()
    const db = await withTimeout(
      openDB(dbName, 1, {
        upgrade(db) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        },
      }),
      OPEN_TIMEOUT_MS,
    )
    return idbStore(db)
  } catch {
    return memoryStore()
  }
}
