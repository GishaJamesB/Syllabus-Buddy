import { useState } from 'react'
import type { FirebaseServices } from './firebase/init'
import { MISCONCEPTIONS, parseTurn, type ParseResult } from './ai/turnSchema'
import { describeError } from './firebase/describeError'

const SAMPLE_REPLY = 'I added 5 and 3 and got 8'

const SYSTEM_PROMPT =
  'You are a maths tutor for a 12-year-old working on perimeter and area. Classify the child reply. ' +
  'intent is one of answer_attempt, needs_clue, review_previous, off_topic. ' +
  `misconception is one of ${MISCONCEPTIONS.join(', ')}, or null. ` +
  'clue is a short hint, or null. Respond with JSON only.'

interface RunOutput {
  parsed: ParseResult
  source: string
}

export default function DiagnosticsRun({ services }: { services: FirebaseServices | null }) {
  const [reply, setReply] = useState(SAMPLE_REPLY)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [output, setOutput] = useState<RunOutput | null>(null)

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

  return (
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
  )
}

const badge = (source: string): React.CSSProperties => ({
  padding: '2px 8px',
  borderRadius: 4,
  color: 'white',
  background: source === 'on_device' ? 'seagreen' : source === 'in_cloud' ? 'steelblue' : 'gray',
})
