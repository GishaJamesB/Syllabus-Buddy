import { useState, type FormEvent } from 'react'
import type { BuddyService } from '../ai/useBuddy'
import type { AccountService } from '../firebase/account'
import { AccountSection } from './AccountSection'
import { BrainStatus } from './BrainStatus'
import { checkNickname, type Profile } from './progress'
import { bigBtn, card, field } from './styles'

interface Props {
  profiles: Profile[]
  onPick: (profile: Profile) => void
  onAdd: (nickname: string, id: string) => Promise<string | null>
  buddy: BuddyService
  account: AccountService
}

export function NicknameScreen({ profiles, onPick, onAdd, buddy, account }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function add(e: FormEvent) {
    e.preventDefault()
    const check = checkNickname(
      name,
      profiles.map((p) => p.id),
    )
    if (!check.ok) return setError(check.error)
    setBusy(true)
    try {
      setError(await onAdd(check.nickname, check.id))
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-3xl font-extrabold text-purple">Who's learning?</h2>

      {profiles.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {profiles.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="w-full rounded-card bg-teal px-6 py-4 text-left text-2xl font-extrabold text-white shadow-card hover:bg-teal/90 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-purple"
              >
                {p.nickname}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className={`${card} space-y-3`} noValidate>
        <label htmlFor="nickname" className="block text-xl font-extrabold">
          Add a nickname
        </label>
        <p id="nickname-hint" className="text-base">
          Use a fun nickname, not your real name.
        </p>
        <input
          id="nickname"
          type="text"
          autoComplete="off"
          autoFocus={profiles.length === 0}
          value={name}
          aria-describedby={error ? 'nickname-hint nickname-error' : 'nickname-hint'}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          className={field}
        />
        <div aria-live="polite">
          {error && (
            <p id="nickname-error" className="rounded-xl bg-danger-soft px-4 py-2 font-bold text-danger">
              {error}
            </p>
          )}
        </div>
        <button type="submit" className={bigBtn} disabled={busy}>
          Start learning
        </button>
      </form>

      <BrainStatus buddy={buddy} />

      <AccountSection account={account} heading="For grown-ups" className={card} />
    </div>
  )
}
