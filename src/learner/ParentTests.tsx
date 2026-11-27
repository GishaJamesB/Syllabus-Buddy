import { mistakeText } from './mistakeText'
import { answeredAt, typedAnswer } from './RecentAnswers'
import { finishedTests, score, testQuestion, type TestRecord, type TestResult } from './test'
import type { Progress } from './progress'

function resultText(result: TestResult | null): string {
  if (!result || result.reason === 'blank') return '✘ Left blank'
  if (result.correct) return '✔ Right'
  return result.code ? `✘ ${mistakeText[result.code]}` : '✘ Not right'
}

function TestDetails({ test }: { test: TestRecord }) {
  return (
    <details className="rounded-xl bg-purple-soft px-4 py-3">
      <summary className="cursor-pointer text-lg font-bold">
        {answeredAt(test.finishedAt as number)}: {score(test)} out of {test.questions.length}
      </summary>
      <ol aria-label={`Test on ${answeredAt(test.finishedAt as number)}`} className="mt-2 space-y-3">
        {test.questions.map((ref, i) => {
          const answer = test.answers[i]
          return (
            <li key={i} className="rounded-xl bg-white px-4 py-3">
              <p>{testQuestion(ref).prompt}</p>
              <p className="mt-1 font-bold">Answer: {answer ? typedAnswer(answer.text, answer.unit) : '(blank)'}</p>
              <p className="mt-1">{resultText(test.results[i])}</p>
            </li>
          )
        })}
      </ol>
    </details>
  )
}

export function ParentTests({ progress }: { progress: Progress }) {
  const tests = finishedTests(progress, Infinity)
  return (
    <div>
      <h3 className="text-xl font-extrabold">Tests</h3>
      {tests.length === 0 ? (
        <p className="mt-2 text-lg">No tests finished yet.</p>
      ) : (
        <div className="mt-2 space-y-3">
          {tests.map((t) => (
            <TestDetails key={t.id} test={t} />
          ))}
        </div>
      )}
    </div>
  )
}
