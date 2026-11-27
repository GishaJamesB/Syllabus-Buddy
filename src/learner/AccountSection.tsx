import { useEffect, useState } from 'react'
import type { AccountService, AccountStatus } from '../firebase/account'
import { softBtn } from './styles'

type State = { kind: 'loading' } | { kind: 'hidden' } | { kind: 'ready'; status: AccountStatus } | { kind: 'busy' } | { kind: 'failed' }

export function AccountSection({ account, heading, className }: { account: AccountService; heading: string; className?: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let live = true
    account
      .status()
      .then((status) => live && setState({ kind: 'ready', status }))
      .catch(() => live && setState({ kind: 'hidden' }))
    return () => {
      live = false
    }
  }, [account])

  async function run(action: () => Promise<void>) {
    setState({ kind: 'busy' })
    try {
      await action()
    } catch {
      setState({ kind: 'failed' })
    }
  }

  if (state.kind === 'loading' || state.kind === 'hidden') return null
  return (
    <div className={className}>
      <h3 className="text-xl font-extrabold">{heading}</h3>
      {state.kind === 'busy' && <p className="mt-2 text-lg">One moment…</p>}
      {state.kind === 'failed' && <p className="mt-2 text-lg text-danger">Sign-in didn't work. Reload the page and try again.</p>}
      {state.kind === 'ready' && !state.status.signedIn && (
        <div className="mt-2 space-y-2">
          <p className="text-lg">
            Progress is saved in this browser only. A grown-up can sign in with Google to keep it, or to bring back
            progress saved on another computer.
          </p>
          <button type="button" className={softBtn} onClick={() => void run(() => account.signIn())}>
            Sign in with Google
          </button>
        </div>
      )}
      {state.kind === 'ready' && state.status.signedIn && (
        <div className="mt-2 space-y-2">
          <p className="text-lg">Progress is saved to {state.status.email ?? 'your Google account'}.</p>
          <p className="text-sm">After signing out, this browser starts fresh. Signing in again brings the progress back.</p>
          <button type="button" className={softBtn} onClick={() => void run(() => account.signOut())}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
