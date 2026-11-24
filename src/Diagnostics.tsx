import { useEffect, useRef, useState } from 'react'
import { readConfig } from './firebase/config'
import { initFirebase, type FirebaseServices } from './firebase/init'
import { getOnDeviceStatus, prepareOnDeviceModel, type OnDeviceStatus } from './ai/onDeviceStatus'
import { MISCONCEPTIONS, parseTurn, type ParseResult } from './ai/turnSchema'
import { describeError, SETUP_GUIDE } from './firebase/describeError'

const SAMPLE_REPLY = 'I added 5 and 3 and got 8'

const SYSTEM_PROMPT =
  'You are a maths tutor for a 12-year-old working on perimeter and area. Classify the child reply. ' +
  'intent is one of answer_attempt, needs_clue, review_previous, off_topic. ' +
  `misconception is one of ${MISCONCEPTIONS.join(', ')}, or null. ` +
  'clue is a short hint, or null. Respond with JSON only.'

const configResult = readConfig(import.meta.env as Record<string, string | undefined>)

interface RunOutput {
  parsed: ParseResult
  source: string
}

export default function Diagnostics() {
  const [services, setServices] = useState<FirebaseServices | null>(null)
  const [initError, setInitError] = useState<string | null>(null)
  const [status, setStatus] = useState<OnDeviceStatus | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [prepError, setPrepError] = useState<string | null>(null)
  const [reply, setReply] = useState(SAMPLE_REPLY)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [output, setOutput] = useState<RunOutput | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (!configResult.ok || started.current) return
    started.current = true
    initFirebase(configResult.config)
      .then(setServices)
      .catch((e: unknown) => setInitError(describeError(e)))
    getOnDeviceStatus().then(setStatus)
  }, [])

  if (!configResult.ok) {
    return (
      <main style={page}>
        <h1>Syllabus Buddy spike</h1>
        <p>Missing environment variables. Copy <code>.env.example</code> to <code>.env.local</code> and fill these in ({SETUP_GUIDE}):</p>
        <ul>
          {configResult.missing.map((k) => (
            <li key={k}><code>{k}</code></li>
          ))}
        </ul>
      </main>
    )
  }

  async function prepare() {
    if (!services) return
    setPrepError(null)
    setProgress(0)
    try {
      const model = services.createTurnModel()
      setStatus(await prepareOnDeviceModel((cb) => model.initializeDeviceModel(cb), setProgress))
    } catch (e) {
      setPrepError(describeError(e))
    } finally {
      setProgress(null)
    }
  }

  async function run() {
    if (!services || !reply.trim()) return
    setRunning(true)
    setRunError(null)
    setOutput(null)
    try {
      const model = services.createTurnModel()
      const { response } = await model.generateContent(`${SYSTEM_PROMPT}\n\nChild reply: ${reply}`)
      setOutput({ parsed: parseTurn(response.text()), source: response.inferenceSource ?? 'unknown' })
    } catch (e) {
      setRunError(describeError(e))
    } finally {
      setRunning(false)
    }
  }

  const mode = configResult.config.inferenceMode
  const nanoLabel =
    status === null
      ? 'checking'
      : status === 'unavailable'
        ? mode === 'only_on_device'
          ? 'not available (no cloud fallback in only_on_device)'
          : 'cloud fallback'
        : status

  return (
    <main style={page}>
      <h1>Syllabus Buddy spike</h1>
      <p>Inference mode: <code>{configResult.config.inferenceMode}</code></p>

      <section>
        <h2>Auth and App Check</h2>
        {initError ? (
          <p role="alert" style={{ color: 'crimson' }}>{initError}</p>
        ) : services ? (
          <p>Anonymous user ID: <code>{services.uid}</code></p>
        ) : (
          <p>Signing in...</p>
        )}
      </section>

      <section>
        <h2>On-device model</h2>
        <p>Status: <strong>{nanoLabel}</strong>{progress !== null && ` (${Math.round(progress * 100)}%)`}</p>
        <button onClick={prepare} disabled={!services || progress !== null || status === 'unavailable' || mode === 'only_in_cloud'}>
          Prepare on-device model
        </button>
        {prepError && <p role="alert" style={{ color: 'crimson' }}>{prepError}</p>}
      </section>

      <section>
        <h2>Structured-output test</h2>
        <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} style={{ width: '100%' }} />
        <button onClick={run} disabled={!services || running || !reply.trim()}>{running ? 'Running...' : 'Run'}</button>
        {runError && <p role="alert" style={{ color: 'crimson' }}>{runError}</p>}
        {output && (
          <div>
            <p>
              Ran: <span style={badge(output.source)}>{output.source === 'on_device' ? 'ON_DEVICE' : output.source === 'in_cloud' ? 'IN_CLOUD' : output.source}</span>
            </p>
            {output.parsed.ok ? (
              <pre>{JSON.stringify(output.parsed.turn, null, 2)}</pre>
            ) : (
              <>
                <p><strong>{output.parsed.error === 'schema_mismatch' ? 'schema mismatch' : 'not JSON'}</strong></p>
                <pre>{output.parsed.raw}</pre>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  )
}

const page: React.CSSProperties = { fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }
const badge = (source: string): React.CSSProperties => ({
  padding: '2px 8px',
  borderRadius: 4,
  color: 'white',
  background: source === 'on_device' ? 'seagreen' : source === 'in_cloud' ? 'steelblue' : 'gray',
})
