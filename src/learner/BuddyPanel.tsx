import { useState, type FormEvent } from 'react'
import { ASK_MAX } from '../ai/buddy'
import { brainRow, usesCloud, type BrainStatus, type BuddyView } from '../ai/useBuddy'
import { field, softBtn } from './styles'

interface Props {
  view: BuddyView | null
  brain: BrainStatus
  ideaTitle: string
  previousTitle: string | null
  onGoBack: () => void
  onAsk: (text: string) => void
}

export function Badge({ source }: { source: 'on_device' | 'in_cloud' | null }) {
  if (!source) return null
  return (
    <span className="ml-2 inline-block rounded-full bg-white px-3 py-1 text-sm font-extrabold text-purple">
      {source === 'on_device' ? '🔒 On this device' : '☁️ Cloud'}
    </span>
  )
}

function Reply({ view, ideaTitle, previousTitle, onGoBack }: Omit<Props, 'brain' | 'onAsk'> & { view: BuddyView }) {
  const { reply } = view
  if (!reply) return <p>Buddy is thinking…</p>
  if (reply.outcome === 'failed') return <p>Buddy is resting right now</p>
  const asked = view.kind === 'ask'
  return (
    <div className="space-y-2">
      <p className="font-extrabold">
        Buddy says
        <Badge source={reply.source} />
      </p>
      {asked && reply.intent === 'off_topic' && <p>Let's get back to {ideaTitle}!</p>}
      {reply.clue && <p>{reply.clue}</p>}
      {asked && reply.intent === 'review_previous' && previousTitle && (
        <button type="button" className={softBtn} onClick={onGoBack}>
          Go back to: {previousTitle}
        </button>
      )}
    </div>
  )
}

export function BuddyPanel({ view, brain, ideaTitle, previousTitle, onGoBack, onAsk }: Props) {
  const [text, setText] = useState('')
  const resting = brain.phase === 'resting' || brainRow(brain).kind === 'needs_device'
  const thinking = view !== null && view.reply === null
  const trimmed = text.trim()

  function submit(e: FormEvent) {
    e.preventDefault()
    if (resting || thinking || trimmed.length === 0 || trimmed.length > ASK_MAX) return
    onAsk(trimmed)
    setText('')
  }

  return (
    <div className="space-y-4">
      <div aria-live="polite" role="status">
        {view && (
          <div className="rounded-xl bg-purple-soft px-4 py-3 text-lg font-bold text-ink">
            <Reply view={view} ideaTitle={ideaTitle} previousTitle={previousTitle} onGoBack={onGoBack} />
          </div>
        )}
      </div>

      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="ask-buddy" className="block text-lg font-extrabold">
          Ask Buddy
        </label>
        <div className="flex gap-2">
          <input
            id="ask-buddy"
            type="text"
            autoComplete="off"
            maxLength={ASK_MAX}
            value={text}
            disabled={resting}
            placeholder="Ask a question or explain your thinking"
            onChange={(e) => setText(e.target.value)}
            className={field}
          />
          <button type="submit" className={softBtn} disabled={resting || thinking || trimmed.length === 0}>
            Ask
          </button>
        </div>
        {usesCloud(brain) && <p className="text-sm">Buddy uses the cloud on this computer</p>}
      </form>
    </div>
  )
}
