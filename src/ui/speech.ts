export const SPEECH_RATE = 0.9
export const UTTERANCE_MAX = 200

const NUMBER = String.raw`(?<![\d.])(\d[\d,]*(?:\.\d+)?)`

const UNIT_WORDS: Record<string, [string, string]> = {
  'sq cm': ['square centimetre', 'square centimetres'],
  'sq m': ['square metre', 'square metres'],
  cm: ['centimetre', 'centimetres'],
  m: ['metre', 'metres'],
}

const unitWord = (unit: string, n: string) => UNIT_WORDS[unit][n === '1' ? 0 : 1]

export function spokenText(text: string): string {
  return text
    .replace(new RegExp(`${NUMBER}\\s?(sq cm|sq m|cm|m)(?![A-Za-z])`, 'g'), (_, n: string, unit: string) => `${n} ${unitWord(unit, n)}`)
    .replace(/(?<![A-Za-z])(sq cm|sq m|cm)(?![A-Za-z])/g, (_, unit: string) => UNIT_WORDS[unit][1])
    .replace(new RegExp(`S\\$\\s?${NUMBER}`, 'g'), (_, n: string) => `${n} ${n === '1' ? 'dollar' : 'dollars'}`)
    .replace(/S\$/g, 'dollars')
}

export function joinForSpeech(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p) => (/[.!?:]$/.test(p) ? p : `${p}.`))
    .join(' ')
}

export function splitUtterances(text: string, max = UTTERANCE_MAX): string[] {
  const out: string[] = []
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    let rest = sentence.trim()
    while (rest.length >= max) {
      const cut = rest.lastIndexOf(' ', max - 1)
      const at = cut > 0 ? cut : max - 1
      out.push(rest.slice(0, at).trim())
      rest = rest.slice(at).trim()
    }
    if (rest) out.push(rest)
  }
  return out
}

export function speechSupported(): boolean {
  return typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined'
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  return english.find((v) => v.localService) ?? english[0] ?? null
}

let playing: symbol | null = null
let run = 0
const listeners = new Set<() => void>()

function setPlaying(next: symbol | null) {
  playing = next
  listeners.forEach((l) => l())
}

export function nowPlaying(): symbol | null {
  return playing
}

export function subscribeSpeech(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function speak(text: string, token: symbol = Symbol('speech')): symbol {
  const synth = globalThis.speechSynthesis
  synth.cancel()
  const parts = splitUtterances(spokenText(text))
  if (parts.length === 0) {
    setPlaying(null)
    return token
  }
  const utterances = parts.map((part) => {
    const u = new SpeechSynthesisUtterance(part)
    u.rate = SPEECH_RATE
    return u
  })
  const voice = pickVoice(synth.getVoices())
  utterances.forEach((u) => {
    if (voice) u.voice = voice
    else u.lang = 'en-GB'
  })
  const id = ++run
  utterances[utterances.length - 1].onend = () => {
    if (id === run && playing === token) setPlaying(null)
  }
  utterances.forEach(
    (u) =>
      (u.onerror = () => {
        if (id !== run) return
        run++
        synth.cancel()
        setPlaying(null)
      }),
  )
  setPlaying(token)
  utterances.forEach((u) => synth.speak(u))
  return token
}

export function stop() {
  globalThis.speechSynthesis?.cancel()
  setPlaying(null)
}

export function stopIfPlaying(token: symbol) {
  if (playing === token) stop()
}
