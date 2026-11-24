import { score, type TestRecord } from './test'

const formatDate = (at: number) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function TestHistory({ tests }: { tests: TestRecord[] }) {
  if (tests.length === 0) return null
  return (
    <div className="text-left">
      <h3 className="text-xl font-extrabold text-purple">Your last tests</h3>
      <ul className="mt-2 space-y-1 text-lg" aria-label="Your last tests">
        {tests.map((t) => (
          <li key={t.id}>
            {score(t)} out of {t.questions.length} on {formatDate(t.finishedAt as number)}
          </li>
        ))}
      </ul>
    </div>
  )
}
