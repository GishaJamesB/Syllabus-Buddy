import type { FirebaseApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  linkWithPopup,
  signInWithCredential,
  signOut,
  type AuthError,
} from 'firebase/auth'
import { collection, doc, getDocs, setDoc, type Firestore } from 'firebase/firestore'
import type { AccountStatus } from './account'

export function accountStatus(app: FirebaseApp): AccountStatus {
  const user = getAuth(app).currentUser
  if (!user || user.isAnonymous) return { signedIn: false }
  return { signedIn: true, email: user.email }
}

export async function copyIfEmpty(firestore: Firestore, toUid: string, profiles: { id: string }[]) {
  const target = collection(firestore, 'users', toUid, 'profiles')
  if (!(await getDocs(target)).empty) return
  for (const profile of profiles) await setDoc(doc(target, profile.id), profile)
}

export async function signInWithGoogle(app: FirebaseApp, firestore: Firestore): Promise<'linked' | 'switched'> {
  const auth = getAuth(app)
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')
  const provider = new GoogleAuthProvider()
  try {
    await linkWithPopup(user, provider)
    return 'linked'
  } catch (e) {
    if ((e as AuthError).code !== 'auth/credential-already-in-use') throw e
    const credential = GoogleAuthProvider.credentialFromError(e as AuthError)
    if (!credential) throw e
    const here = await getDocs(collection(firestore, 'users', user.uid, 'profiles'))
    const profiles = here.docs.map((d) => d.data() as { id: string })
    const signedIn = await signInWithCredential(auth, credential)
    await copyIfEmpty(firestore, signedIn.user.uid, profiles)
    return 'switched'
  }
}

export async function signOutOfGoogle(app: FirebaseApp) {
  await signOut(getAuth(app))
}
