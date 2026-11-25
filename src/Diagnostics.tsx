import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { readConfig } from './firebase/config'
import { initFirebase, type FirebaseServices } from './firebase/init'
import { getOnDeviceStatus, prepareOnDeviceModel, type OnDeviceStatus } from './ai/onDeviceStatus'
import { describeError, SETUP_GUIDE } from './firebase/describeError'
import { TUNING_KEYS } from './config/tuning'

export const DiagnosticsRun = import.meta.env.DEV ? lazy(() => import('./DiagnosticsRun')) : null

const configResult = readConfig(import.meta.env as Record<string, string | undefined>)

export default function Diagnostics() {
  const [services, setServices] = useState<FirebaseServices | null>(null)
  const [initError, setInitError] = useState<string | null>(null)
  const [status, setStatus] = useState<OnDeviceStatus | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [prepError, setPrepError] = useState<string | null>(null)
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
        <h1>Syllabus Buddy diagnostics</h1>
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

  const mode = services?.tuning.values.inference_mode ?? configResult.config.inferenceMode
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
      <h1>Syllabus Buddy diagnostics</h1>
      <p>Inference mode: <code>{mode}</code></p>

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
        <h2>Tuning</h2>
        {services ? (
          <table>
            <thead>
              <tr><th align="left">Key</th><th align="left">Value</th><th align="left">From</th><th align="left">Rejected</th></tr>
            </thead>
            <tbody>
              {TUNING_KEYS.map((k) => (
                <tr key={k}>
                  <td><code>{k}</code></td>
                  <td><code>{String(services.tuning.values[k])}</code></td>
                  <td>{services.tuning.sources[k]}</td>
                  <td>{services.tuning.raw[k] !== undefined && <code>{services.tuning.raw[k]}</code>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Waiting for Firebase...</p>
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

      {DiagnosticsRun && (
        <Suspense fallback={null}>
          <DiagnosticsRun services={services} />
        </Suspense>
      )}
    </main>
  )
}

const page: React.CSSProperties = { fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }
