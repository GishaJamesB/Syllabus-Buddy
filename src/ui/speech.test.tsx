// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadAloud } from './ReadAloud'
import { joinForSpeech, nowPlaying, speak, splitUtterances, spokenText, stop, SPEECH_RATE, UTTERANCE_MAX } from './speech'

class FakeUtterance {
  text: string
  rate = 1
  lang = ''
  voice: { name: string } | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

function fakeSynth(voices: { name: string; lang: string; localService: boolean }[] = []) {
  const listeners = new Map<string, () => void>()
  return {
    spoken: [] as FakeUtterance[],
    voices,
    speak: vi.fn(function (this: { spoken: FakeUtterance[] }, u: FakeUtterance) {
      this.spoken.push(u)
    }),
    cancel: vi.fn(),
    getVoices() {
      return this.voices
    },
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
    fire: (name: string) => listeners.get(name)?.(),
  }
}

let synth: ReturnType<typeof fakeSynth>

function install(voices?: Parameters<typeof fakeSynth>[0]) {
  synth = fakeSynth(voices)
  vi.stubGlobal('speechSynthesis', synth)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
}

beforeEach(() => install())

afterEach(() => {
  cleanup()
  stop()
  vi.unstubAllGlobals()
})

describe('spokenText', () => {
  it.each([
    ['The area is 12 sq cm.', 'The area is 12 square centimetres.'],
    ['A field of 40 sq m', 'A field of 40 square metres'],
    ['Each side is 5 cm long', 'Each side is 5 centimetres long'],
    ['The rope is 8 m long and 3m wide', 'The rope is 8 metres long and 3 metres wide'],
    ['It costs S$480 in total', 'It costs 480 dollars in total'],
    ['Write the unit S$', 'Write the unit dollars'],
    ['Mia made a map', 'Mia made a map'],
    ['A 5cm side and a 3m rope', 'A 5 centimetres side and a 3 metres rope'],
    ['Each side is 1 cm and the rope is 1 m', 'Each side is 1 centimetre and the rope is 1 metre'],
    ['One tile is 1 sq cm, two are 2 sq cm', 'One tile is 1 square centimetre, two are 2 square centimetres'],
    ['A 1 sq m mat costs S$1', 'A 1 square metre mat costs 1 dollar'],
    ['Write it in cm or sq m', 'Write it in centimetres or square metres'],
    ['It is 15 cm, not 21 m', 'It is 15 centimetres, not 21 metres'],
    ['scm and cms stay', 'scm and cms stay'],
  ])('%j', (input, expected) => {
    expect(spokenText(input)).toBe(expected)
  })
})

describe('splitUtterances', () => {
  it('splits at sentence ends and keeps each part under the limit', () => {
    expect(splitUtterances('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?'])
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    const parts = splitUtterances(long)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((p) => p.length < UTTERANCE_MAX)).toBe(true)
    expect(parts.join(' ')).toBe(long)
  })

  it('ends each joined part with a full stop', () => {
    expect(joinForSpeech(['Perimeter', 'Add every side.', ' '])).toBe('Perimeter. Add every side.')
  })
})

describe('speak', () => {
  it('cancels first, prefers a local English voice, and uses the rate', () => {
    install([
      { name: 'fr', lang: 'fr-FR', localService: true },
      { name: 'net', lang: 'en-US', localService: false },
      { name: 'local', lang: 'en-GB', localService: true },
    ])
    speak('One. Two.')
    expect(synth.cancel).toHaveBeenCalledBefore(synth.speak)
    expect(synth.spoken.map((u) => [u.text, u.voice?.name, u.rate])).toEqual([
      ['One.', 'local', SPEECH_RATE],
      ['Two.', 'local', SPEECH_RATE],
    ])
  })

  it('sets en-GB without voices, adds no listener, and picks a voice on a later call', () => {
    const add = vi.spyOn(synth, 'addEventListener')
    speak('Hello.')
    expect(synth.spoken[0].lang).toBe('en-GB')
    expect(synth.spoken[0].voice).toBeNull()
    expect(add).not.toHaveBeenCalled()
    synth.voices.push({ name: 'later', lang: 'en-IN', localService: false })
    speak('Again.')
    expect(synth.spoken[1].voice?.name).toBe('later')
  })

  it('ignores a late error from an older run and cancels the queue on an error', () => {
    speak('Old one. Old two.')
    const b = speak('New one. New two.')
    synth.spoken[0].onerror?.()
    expect(nowPlaying()).toBe(b)
    const cancels = synth.cancel.mock.calls.length
    synth.spoken[2].onerror?.()
    expect(nowPlaying()).toBeNull()
    expect(synth.cancel.mock.calls.length).toBe(cancels + 1)
  })

  it('clears the state on end, on error and on stop', () => {
    const a = speak('One. Two.')
    expect(nowPlaying()).toBe(a)
    synth.spoken[0].onend?.()
    expect(nowPlaying()).toBe(a)
    synth.spoken[1].onend?.()
    expect(nowPlaying()).toBeNull()
    speak('Again.')
    synth.spoken[2].onerror?.()
    expect(nowPlaying()).toBeNull()
    speak('Once more.')
    stop()
    expect(nowPlaying()).toBeNull()
  })
})

describe('ReadAloud', () => {
  it('toggles to Stop, lets only one thing play, and stops on unmount', () => {
    function Two() {
      const [shown, setShown] = useState(true)
      return (
        <>
          {shown && <ReadAloud label="Read the first card aloud" parts={['First card', 'It is 5 cm.']} />}
          <ReadAloud label="Read the second card aloud" parts={['Second card']} />
          <button onClick={() => setShown(false)}>leave</button>
        </>
      )
    }
    render(<Two />)
    const first = screen.getByRole('button', { name: 'Read the first card aloud' })
    const second = screen.getByRole('button', { name: 'Read the second card aloud' })
    expect(first.textContent).toBe('🔊 Read to me')
    expect(first.getAttribute('title')).toBe("Uses your browser's voice")
    fireEvent.click(first)
    expect(synth.spoken.map((u) => u.text)).toEqual(['First card.', 'It is 5 centimetres.'])
    expect(first.getAttribute('aria-pressed')).toBe('true')
    expect(first.textContent).toBe('⏹ Stop')
    expect(second.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(second)
    expect(synth.spoken.at(-1)?.text).toBe('Second card.')
    expect(first.getAttribute('aria-pressed')).toBe('false')
    expect(second.getAttribute('aria-pressed')).toBe('true')

    const cancels = synth.cancel.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'leave' }))
    expect(synth.cancel.mock.calls.length).toBe(cancels)
    expect(nowPlaying()).not.toBeNull()

    fireEvent.click(second)
    expect(nowPlaying()).toBeNull()
    expect(second.getAttribute('aria-pressed')).toBe('false')
  })

  it('stops its own speech when it unmounts', () => {
    const { unmount } = render(<ReadAloud parts={['Bye']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }))
    act(() => unmount())
    expect(nowPlaying()).toBeNull()
  })

  it('is hidden when speech is not supported', () => {
    vi.unstubAllGlobals()
    render(<ReadAloud parts={['Hello']} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
