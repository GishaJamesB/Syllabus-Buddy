import { useEffect, useState, type FormEvent } from 'react'
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
  const saved = profiles[0]

  useEffect(() => {
    if (saved) onPick(saved)
  }, [saved, onPick])

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

  if (saved) return null

  return (
    <div className="space-y-5">
      <h2 className="text-3xl font-extrabold text-purple">Who's learning?</h2>

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
          autoFocus
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

      <AccountSection account={account} heading="For parents" className={card} />
    </div>
  )
}
