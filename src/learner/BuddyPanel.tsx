import { usesCloud, type BrainStatus, type BuddyView } from '../ai/useBuddy'
import { ReadAloud } from '../ui/ReadAloud'

interface Props {
  view: BuddyView | null
  brain: BrainStatus
}

export function Badge({ source }: { source: 'on_device' | 'in_cloud' | null }) {
  if (!source) return null
  return (
    <span className="ml-2 inline-block rounded-full bg-white px-3 py-1 text-sm font-extrabold text-purple">
      {source === 'on_device' ? '🔒 On this device' : '☁️ Cloud'}
    </span>
  )
}

function Reply({ view }: { view: BuddyView }) {
  const { reply } = view
  if (!reply) return <p>Buddy is thinking…</p>
  if (reply.outcome === 'failed') return <p>Buddy is resting right now</p>
  return (
    <div className="space-y-2">
      <p className="font-extrabold">
        Buddy says
        <Badge source={reply.source} />
      </p>
      {reply.clue && (
        <div className="flex flex-wrap items-center gap-3">
          <p>{reply.clue}</p>
          <ReadAloud key={reply.clue} label="Read Buddy's clue aloud" parts={[reply.clue]} />
        </div>
      )}
    </div>
  )
}

export function BuddyPanel({ view, brain }: Props) {
  return (
    <div className="space-y-4">
      <div aria-live="polite" role="status">
        {view && (
          <div className="rounded-xl bg-purple-soft px-4 py-3 text-lg font-bold text-ink">
            <Reply view={view} />
          </div>
        )}
      </div>
      {usesCloud(brain) && <p className="text-sm">Buddy uses the cloud on this computer</p>}
    </div>
  )
}
