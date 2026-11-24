import { useEffect, useRef, useSyncExternalStore } from 'react'
import { joinForSpeech, nowPlaying, speak, speechSupported, stop, stopIfPlaying, subscribeSpeech } from './speech'

const speakBtn =
  'rounded-full bg-sun/40 px-4 py-2 text-base font-extrabold text-ink hover:bg-sun focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-purple'

interface Props {
  parts: string[]
  label?: string
}

export function ReadAloud({ parts, label = 'Read aloud' }: Props) {
  const token = useRef(Symbol('read-aloud'))
  const playing = useSyncExternalStore(subscribeSpeech, nowPlaying)
  const mine = playing === token.current

  useEffect(() => {
    const own = token.current
    return () => stopIfPlaying(own)
  }, [])

  if (!speechSupported()) return null

  return (
    <button
      type="button"
      className={speakBtn}
      aria-label={label}
      aria-pressed={mine}
      title="Uses your browser's voice"
      onClick={() => (mine ? stop() : speak(joinForSpeech(parts), token.current))}
    >
      <span aria-hidden="true">{mine ? '⏹' : '🔊'}</span> {mine ? 'Stop' : 'Read to me'}
    </button>
  )
}
