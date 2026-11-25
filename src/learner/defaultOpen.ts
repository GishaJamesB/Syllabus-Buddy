import { withTimeout } from '../ai/buddy'
import type { FirebaseServices } from '../firebase/init'
import { sharedFirebase } from '../firebase/shared'
import { firestoreStore } from './firestoreStore'
import { openStore, type Store } from './store'

export const FIREBASE_OPEN_TIMEOUT_MS = 8000

export async function openLearnerStore(
  load: () => Promise<Pick<FirebaseServices, 'firestore' | 'uid'>> = sharedFirebase,
  fallback: () => Promise<Store> = () => openStore(),
): Promise<Store> {
  try {
    const { firestore, uid } = await withTimeout(load(), FIREBASE_OPEN_TIMEOUT_MS)
    return firestoreStore(firestore, uid)
  } catch {
    return fallback()
  }
}
