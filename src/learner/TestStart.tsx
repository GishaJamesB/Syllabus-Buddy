import { useEffect, useRef } from 'react'
import { bigBtn, card } from './styles'
import { TestHistory } from './TestHistory'
import { TEST_LENGTH, type TestRecord } from './test'
import { formatClock } from './TestScreen'

interface Props {
  history: TestRecord[]
  timeLimitS: number | null
  remainingMs: number | null
  onBegin: () => void
}

export function TestStart({ history, timeLimitS, remainingMs, onBegin }: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  const resumable = remainingMs !== null

  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <section className={`${card} space-y-4`}>
      <h2 ref={heading} tabIndex={-1} className="text-3xl font-extrabold text-purple focus:outline-none">
        Test time
      </h2>
      <p className="text-lg">
        {TEST_LENGTH} questions with fresh numbers, including the kinds you found tricky. You will see your marks at the end.
      </p>
      {resumable ? (
        <p className="text-lg font-bold">You have {formatClock(remainingMs)} left. The clock kept running while you were away.</p>
      ) : (
        timeLimitS !== null && (
          <p className="text-lg font-bold">You have {formatClock(timeLimitS * 1000)} for the whole test. The clock starts when you press Begin.</p>
        )
      )}
      <p className="text-lg">Questions you skip or don't reach before time runs out count as wrong.</p>
      <button type="button" className={bigBtn} onClick={onBegin}>
        {resumable ? 'Resume' : 'Begin'}
      </button>
      <TestHistory tests={history} />
    </section>
  )
}
