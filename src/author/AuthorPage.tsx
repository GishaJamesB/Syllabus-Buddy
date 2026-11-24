import { useEffect, useMemo, useRef, useState } from 'react'
import { readConfig } from '../firebase/config'
import { initFirebase, type FirebaseServices } from '../firebase/init'
import { describeError, SETUP_GUIDE } from '../firebase/describeError'
import { lessonJsonSchema, renumber, validateLesson, type Idea, type Lesson, type LessonIssue } from '../content/lessonSchema'
import { RETRY_DELAYS_MS } from '../ai/retry'
import { checkPdfFile, draftLesson, DRAFT_MODEL, DRAFT_TIMEOUT_MS } from './draftLesson'
import { IdeaCard } from './IdeaCard'
import { Confetti } from '../ui/Confetti'

const configResult = readConfig(import.meta.env as Record<string, string | undefined>)

const bigBtn =
  'rounded-full bg-orange px-8 py-3 text-lg font-extrabold text-white shadow-card hover:bg-orange/90 disabled:cursor-not-allowed disabled:opacity-50'

export default function AuthorPage() {
  const [services, setServices] = useState<FirebaseServices | null>(null)
  const [initError, setInitError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileMessage, setFileMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [retryNote, setRetryNote] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)
  const [celebrate, setCelebrate] = useState(0)
  const [notes, setNotes] = useState<LessonIssue[]>([])
  const [dirty, setDirty] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (!configResult.ok || started.current) return
    started.current = true
    initFirebase(configResult.config)
      .then(setServices)
      .catch((e: unknown) => setInitError(describeError(e)))
  }, [])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const validation = useMemo(() => (lesson ? validateLesson(lesson) : null), [lesson])

  if (!configResult.ok) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p>
          Missing environment variables ({SETUP_GUIDE}): {configResult.missing.join(', ')}
        </p>
      </main>
    )
  }

  function pick(f: File | undefined) {
    setFile(null)
    setFileMessage(null)
    if (!f) return
    const check = checkPdfFile(f)
    if (!check.ok) return setFileMessage(check.message)
    setFile(f)
  }

  async function generateDraft() {
    if (!services || !file) return
    if (lesson && dirty && !confirm('Replace your edited draft?')) return
    setBusy(true)
    setDraftError(null)
    try {
      const model = services.createAuthorModel(import.meta.env.VITE_AUTHOR_MODEL?.trim() || DRAFT_MODEL,DRAFT_TIMEOUT_MS, lessonJsonSchema() as unknown as Record<string, unknown>)
      const draft = await draftLesson(model, file, (attempt, waitMs) =>
        setRetryNote(`The model is busy. Trying again in ${waitMs / 1000} s (retry ${attempt} of ${RETRY_DELAYS_MS.length})...`),
      )
      setLesson(draft.lesson)
      setNotes(draft.notes)
      setDirty(false)
    } catch (e) {
      setDraftError(describeError(e))
    } finally {
      setBusy(false)
      setRetryNote(null)
    }
  }

  function updateIdeas(fn: (ideas: Idea[]) => Idea[]) {
    setDirty(true)
    setLesson((l) => (l ? renumber({ ...l, ideas: fn(l.ideas) }) : l))
  }

  async function save() {
    if (!lesson || !validation?.ok) return
    setSaving(true)
    setToast(null)
    try {
      const res = await fetch('/__author/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lesson) })
      const body = (await res.json().catch(() => ({ message: res.statusText }))) as { message?: string }
      setToast({ text: body.message || res.statusText || 'Save failed.', ok: res.ok })
      if (res.ok) {
        setDirty(false)
        setCelebrate((n) => n + 1)
      }
    } catch (e) {
      setToast({ text: describeError(e), ok: false })
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 font-sans">
      <header className="rounded-card bg-purple p-6 text-white shadow-card">
        <h1 className="text-3xl font-extrabold">Author mode</h1>
        <p className="mt-1">Turn the chapter PDF into a lesson, tidy it up, then save it.</p>
      </header>

      <section className="rounded-card bg-white p-5 shadow-card">
        <label className="block text-lg font-extrabold" htmlFor="pdf">
          Chapter PDF
        </label>
        <input
          id="pdf"
          type="file"
          accept="application/pdf"
          className="mt-2 block w-full text-base"
          onChange={(e) => {
            pick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {file && <p className="mt-2 font-bold text-teal">Selected: {file.name}</p>}
        {!services && !initError && <p role="status" className="mt-2 font-bold">Connecting to Firebase…</p>}
        {fileMessage && (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 font-bold text-danger">
            {fileMessage}
          </p>
        )}
        {initError && (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 font-bold text-danger">
            {initError}
          </p>
        )}
        <div className="mt-4">
          <button className={bigBtn} disabled={!services || !file || busy} onClick={generateDraft}>
            {busy ? 'Reading the chapter...' : lesson ? 'Draft again' : 'Draft the lesson'}
          </button>
        </div>
        {busy && (
          <p role="status" className="mt-3 font-bold text-teal">
            {retryNote ?? 'The cloud model is reading the PDF. This can take a couple of minutes.'}
          </p>
        )}
        {draftError && (
          <div role="alert" className="mt-3 rounded-xl bg-danger-soft p-4 text-danger">
            <p className="font-bold">{draftError}</p>
            {lesson && <p className="mt-1 text-sm">Your previous draft is still below.</p>}
            <button className="mt-3 rounded-full bg-danger px-6 py-2 font-extrabold text-white" onClick={generateDraft} disabled={busy}>
              Retry
            </button>
          </div>
        )}
      </section>

      {lesson && validation && (
        <>
          <label className="block rounded-card bg-white p-5 text-sm font-bold shadow-card">
            Lesson title
            <input
              className="mt-1 w-full rounded-xl border-2 border-purple/40 bg-white px-3 py-2 text-base focus:border-purple focus:outline-none"
              value={lesson.title}
              onChange={(e) => {
                setDirty(true)
                setLesson({ ...lesson, title: e.target.value })
              }}
            />
          </label>
          {notes.map((n, i) => (
            <p key={i} role="status" className="rounded-xl bg-warn-soft px-3 py-2 font-bold">
              {n.message}
            </p>
          ))}
          {validation.errors.filter((e) => e.ideaIndex === null).map((e, i) => (
            <p key={i} role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-bold text-danger">
              {e.message}
            </p>
          ))}
          {lesson.ideas.map((idea, i) => (
            <IdeaCard
              key={`${idea.id}-${i}`}
              idea={idea}
              index={i}
              total={lesson.ideas.length}
              issues={[...validation.errors, ...validation.warnings].filter((x) => x.ideaIndex === i)}
              onChange={(next) => updateIdeas((ideas) => ideas.map((x, j) => (j === i ? next : x)))}
              onMove={(d) =>
                updateIdeas((ideas) => {
                  const copy = [...ideas]
                  ;[copy[i], copy[i + d]] = [copy[i + d], copy[i]]
                  return copy
                })
              }
              canDelete={lesson.ideas.length > 1}
              onDelete={() => updateIdeas((ideas) => ideas.filter((_, j) => j !== i))}
            />
          ))}
          <div className="sticky bottom-4 flex flex-wrap items-center gap-4 rounded-card bg-white p-4 shadow-card">
            <button className={bigBtn} disabled={!validation.ok || saving} onClick={save}>
              {saving ? 'Saving...' : 'Save lesson'}
            </button>
            <span className="font-bold">
              {validation.ok
                ? validation.warnings.length
                  ? `Ready to save (${validation.warnings.length} warning(s))`
                  : 'Ready to save'
                : `${validation.errors.length} error(s) to fix before saving`}
            </span>
          </div>
        </>
      )}

      {toast && (
        <p
          role="status"
          className={`fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full px-6 py-3 text-lg font-extrabold shadow-card ${toast.ok ? 'bg-teal text-white' : 'bg-danger text-white'}`}
        >
          {toast.text}
          <button aria-label="Dismiss" className="font-extrabold" onClick={() => setToast(null)}>
            ×
          </button>
        </p>
      )}
      {celebrate > 0 && <Confetti key={celebrate} />}
    </main>
  )
}
