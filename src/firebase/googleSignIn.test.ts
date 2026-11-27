import { beforeEach, describe, expect, it, vi } from 'vitest'

const docs = new Map<string, unknown>()
const auth = { currentUser: null as { uid: string; isAnonymous: boolean; email: string | null } | null }
let linkError: { code: string } | null = null
const credential = { providerId: 'google.com' }

interface Ref {
  path: string
}

const snapshot = (path: string) => ({ exists: () => docs.has(path), data: () => structuredClone(docs.get(path)) })

vi.mock('firebase/auth', () => ({
  getAuth: () => auth,
  GoogleAuthProvider: Object.assign(class {}, { credentialFromError: () => credential }),
  linkWithPopup: async () => {
    if (linkError) throw linkError
  },
  signInWithCredential: async (_: unknown, c: unknown) => {
    expect(c).toBe(credential)
    auth.currentUser = { uid: 'google-user', isAnonymous: false, email: 'parent@example.com' }
    return { user: auth.currentUser }
  },
  signOut: async () => {
    auth.currentUser = null
  },
}))

vi.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  doc: (parent: Ref, id: string) => ({ path: `${parent.path}/${id}` }),
  getDoc: async (ref: Ref) => snapshot(ref.path),
  getDocs: async (ref: Ref) => ({
    docs: [...docs.keys()].filter((k) => k.startsWith(`${ref.path}/`)).map((k) => snapshot(k)),
  }),
  setDoc: async (ref: Ref, data: unknown) => {
    docs.set(ref.path, structuredClone(data))
  },
}))

const { accountStatus, signInWithGoogle, signOutOfGoogle } = await import('./googleSignIn')

const app = {} as never
const firestore = {} as never

beforeEach(() => {
  docs.clear()
  linkError = null
  auth.currentUser = { uid: 'anon', isAnonymous: true, email: null }
})

describe('accountStatus', () => {
  it('is signed out for an anonymous user and signed in with the email for a Google user', () => {
    expect(accountStatus(app)).toEqual({ signedIn: false })
    auth.currentUser = { uid: 'g', isAnonymous: false, email: 'parent@example.com' }
    expect(accountStatus(app)).toEqual({ signedIn: true, email: 'parent@example.com' })
  })
})

describe('signInWithGoogle', () => {
  it('links the anonymous account so the same user and data are kept', async () => {
    docs.set('users/anon/profiles/riya', { id: 'riya', nickname: 'Riya' })
    expect(await signInWithGoogle(app, firestore)).toBe('linked')
    expect([...docs.keys()]).toEqual(['users/anon/profiles/riya'])
  })

  it('switches to the existing Google account and copies only the nicknames it does not have', async () => {
    linkError = { code: 'auth/credential-already-in-use' }
    docs.set('users/anon/profiles/riya', { id: 'riya', nickname: 'Riya', from: 'here' })
    docs.set('users/anon/profiles/sam', { id: 'sam', nickname: 'Sam' })
    docs.set('users/google-user/profiles/riya', { id: 'riya', nickname: 'Riya', from: 'there' })

    expect(await signInWithGoogle(app, firestore)).toBe('switched')
    expect(docs.get('users/google-user/profiles/riya')).toEqual({ id: 'riya', nickname: 'Riya', from: 'there' })
    expect(docs.get('users/google-user/profiles/sam')).toEqual({ id: 'sam', nickname: 'Sam' })
  })

  it('passes on other sign-in errors', async () => {
    linkError = { code: 'auth/popup-closed-by-user' }
    await expect(signInWithGoogle(app, firestore)).rejects.toEqual(linkError)
  })
})

describe('signOutOfGoogle', () => {
  it('signs out', async () => {
    auth.currentUser = { uid: 'g', isAnonymous: false, email: null }
    await signOutOfGoogle(app)
    expect(auth.currentUser).toBeNull()
  })
})
