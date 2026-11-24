import { useEffect, useRef } from 'react'
import { Confetti } from '../ui/Confetti'
import { bigBtn, card, softBtn } from './styles'
import { TestHistory } from './TestHistory'
import type { TestRecord } from './test'

interface Props {
  nickname: string
  chapterTitle: string
  history: TestRecord[]
  onStartAgain: () => void
  onTakeTest: () => void
}

export function CompleteScreen({ nickname, chapterTitle, history, onStartAgain, onTakeTest }: Props) {
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <section className={`${card} space-y-4 text-center`}>
      <h2 ref={heading} tabIndex={-1} className="text-4xl font-extrabold text-purple focus:outline-none">
        Chapter complete
      </h2>
      <p className="text-xl">
        Amazing work, {nickname}! You finished every idea in {chapterTitle}.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" className={bigBtn} onClick={onTakeTest}>
          Take the test
        </button>
        <button type="button" className={softBtn} onClick={onStartAgain}>
          Start again
        </button>
      </div>
      <TestHistory tests={history} />
      <Confetti />
    </section>
  )
}
