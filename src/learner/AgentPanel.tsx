import type { LogEntry, TutorOutcome, TutorSummary } from '../ai/tutorAgent'
import type { MistakeCode } from '../maths/types'
import { mistakeText } from './mistakeText'

const ENDINGS: Record<TutorOutcome, string> = {
  mastered: 'Ended: the idea is mastered',
  out_of_turns: 'Ended: out of turns, so the worked steps were shown',
  navigated: 'Ended: moved to another idea',
  failed: 'Ended: the tutor stopped',
}

const describeMistake = (code: string) => mistakeText[code as MistakeCode] ?? code

function parseSummary(text: string): TutorSummary | null {
  try {
    return JSON.parse(text) as TutorSummary
  } catch {
    return null
  }
}

function SentSummary({ text }: { text: string }) {
  const summary = parseSummary(text)
  return (
    <div>
      <p className="font-extrabold">Sent to the cloud</p>
      {summary && (
        <div className="mt-1 space-y-1">
          <p>Idea: {summary.idea.title}</p>
          <p>Wrong tries so far: {summary.misses}</p>
          <p>
            Mistakes spotted:{' '}
            {summary.mistakeCodes.length > 0 ? summary.mistakeCodes.map(describeMistake).join('; ') : 'none named yet'}
          </p>
          <p>No nickname and nothing your child typed was sent.</p>
        </div>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-ink/70">Show the exact data</summary>
        <pre className="mt-1 overflow-x-auto rounded-lg bg-white p-3 text-sm whitespace-pre-wrap">{text}</pre>
      </details>
    </div>
  )
}

function Entry({ entry }: { entry: LogEntry }) {
  switch (entry.kind) {
    case 'summary':
      return <SentSummary text={entry.text} />
    case 'call':
      return (
        <div>
          <p className="font-extrabold">
            {entry.label}
            {entry.by === 'app' && <span className="ml-2 text-sm">(by the app)</span>}
          </p>
          <p className="font-mono text-xs break-all text-ink/70">
            {entry.name}({Object.keys(entry.args).length > 0 ? JSON.stringify(entry.args) : ''})
          </p>
          {entry.error && <p className="text-sm text-danger">Refused: {entry.error}</p>}
        </div>
      )
    case 'result':
      return (
        <p className="font-extrabold">
          {entry.correct ? '✔ Practice answer right' : '✘ Practice answer not right'}
          {entry.code && <span className="ml-2 text-sm font-normal">({describeMistake(entry.code)})</span>}
        </p>
      )
    case 'end':
      return <p className="font-extrabold">{ENDINGS[entry.outcome]}</p>
  }
}

export function AgentPanel({ log }: { log: LogEntry[] }) {
  return (
    <details className="rounded-xl bg-purple-soft px-4 py-3">
      <summary className="cursor-pointer text-lg font-extrabold text-purple">What the AI did (for grown-ups)</summary>
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
