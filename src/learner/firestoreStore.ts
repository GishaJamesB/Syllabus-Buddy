import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, type Firestore } from 'firebase/firestore'
import type { Profile } from './progress'
import { byRecent, NicknameTakenError, type Store } from './store'

export function firestoreStore(db: Firestore, uid: string): Store {
  const profiles = collection(db, 'users', uid, 'profiles')
  return {
    persistent: true,
    async listProfiles() {
      const snapshot = await getDocs(profiles)
      return snapshot.docs.map((d) => d.data() as Profile).sort(byRecent)
    },
    async addProfile(profile) {
      const ref = doc(profiles, profile.id)
      if ((await getDoc(ref)).exists()) throw new NicknameTakenError()
      await setDoc(ref, profile)
    },
    async loadProfile(id) {
      const snapshot = await getDoc(doc(profiles, id))
      return snapshot.exists() ? (snapshot.data() as Profile) : null
    },
    async saveProfile(profile) {
      await setDoc(doc(profiles, profile.id), profile)
    },
    async deleteProfile(id) {
      await deleteDoc(doc(profiles, id))
    },
  }
}
