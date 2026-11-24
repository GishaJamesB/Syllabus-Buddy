import { useEffect, useRef } from 'react'
import { Confetti } from '../ui/Confetti'
import { bigBtn, card } from './styles'

interface Props {
  nickname: string
  chapterTitle: string
  onStartAgain: () => void
}

export function CompleteScreen({ nickname, chapterTitle, onStartAgain }: Props) {
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
      <button type="button" className={bigBtn} onClick={onStartAgain}>
        Start again
      </button>
      <Confetti />
    </section>
  )
}
