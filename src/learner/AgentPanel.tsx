import type { LogEntry, TutorOutcome } from '../ai/tutorAgent'

const ENDINGS: Record<TutorOutcome, string> = {
  mastered: 'Ended: the idea is mastered',
  out_of_turns: 'Ended: out of turns, so the worked steps were shown',
  navigated: 'Ended: moved to another idea',
  failed: 'Ended: the tutor stopped',
}

function Entry({ entry }: { entry: LogEntry }) {
  switch (entry.kind) {
    case 'summary':
      return (
        <div>
          <p className="font-extrabold">Sent to the cloud</p>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-white p-3 text-sm whitespace-pre-wrap">{entry.text}</pre>
        </div>
      )
    case 'call':
      return (
        <div>
          <p className="font-extrabold">
            {entry.label}
            {entry.by === 'app' && <span className="ml-2 text-sm">(by the app)</span>}
          </p>
          <p className="font-mono text-sm break-all">
            {entry.name}({Object.keys(entry.args).length > 0 ? JSON.stringify(entry.args) : ''})
          </p>
          {entry.error && <p className="text-sm text-danger">Refused: {entry.error}</p>}
        </div>
      )
    case 'result':
      return (
        <p className="font-extrabold">
          {entry.correct ? '✔ Practice answer right' : '✘ Practice answer not right'}
          {entry.code && <span className="ml-2 font-mono text-sm">{entry.code}</span>}
        </p>
      )
    case 'end':
      return <p className="font-extrabold">{ENDINGS[entry.outcome]}</p>
  }
}

export function AgentPanel({ log }: { log: LogEntry[] }) {
  return (
    <details open className="rounded-xl bg-purple-soft px-4 py-3">
      <summary className="cursor-pointer text-lg font-extrabold text-purple">What the AI did</summary>
      <ol aria-label="What the AI did" className="mt-3 list-decimal space-y-3 pl-6">
        {log.map((entry, i) => (
          <li key={i}>
            <Entry entry={entry} />
          </li>
        ))}
      </ol>
    </details>
  )
}
