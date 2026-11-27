import { sharedFirebase } from './shared'

export type AccountStatus = { signedIn: false } | { signedIn: true; email: string | null }

export interface AccountService {
  status(): Promise<AccountStatus>
  signIn(): Promise<void>
  signOut(): Promise<void>
}

export function firebaseAccount(): AccountService {
  const load = async () => ({ services: await sharedFirebase(), google: await import('./googleSignIn') })
  return {
    async status() {
      const { services, google } = await load()
      return google.accountStatus(services.app)
    },
    async signIn() {
      const { services, google } = await load()
      await google.signInWithGoogle(services.app, services.firestore)
      window.location.reload()
    },
    async signOut() {
      const { services, google } = await load()
      await google.signOutOfGoogle(services.app)
      window.location.reload()
    },
  }
}
