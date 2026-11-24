import { useEffect, useMemo, useRef, useState } from 'react'
import { brainRow, useBrainStatus, type BuddyService } from '../ai/useBuddy'
import type { Lesson } from '../content/lessonSchema'
import { parentSummary, writeSummary } from './parentSummary'
import type { Profile } from './progress'
import { card, softBtn } from './styles'

interface Props {
  profile: Profile
  lesson: Lesson
  buddy: BuddyService
  onClose: () => void
}

export const NO_NANO_NOTE = 'A written summary needs on-device AI in Chrome.'
export const SUMMARY_FAILED = "Couldn't write a summary this time."

type Paragraph = { kind: 'writing' } | { kind: 'done'; text: string } | { kind: 'failed' } | { kind: 'none' }

export function ParentPanel({ profile, lesson, buddy, onClose }: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  const brain = useBrainStatus(buddy)
  const onDevice = brainRow(brain).kind === 'device'
  const summary = useMemo(() => parentSummary(profile, lesson), [profile, lesson])
  const dataKey = JSON.stringify([summary.title, summary.mistakes, summary.scores])
  const canWrite = onDevice && summary.mistakes.length > 0
  const [paragraph, setParagraph] = useState<Paragraph>(() => (canWrite ? { kind: 'writing' } : { kind: 'none' }))
  const latest = useRef(summary)
  latest.current = summary

  useEffect(() => {
    heading.current?.focus()
  }, [])

  useEffect(() => {
    if (!canWrite) return setParagraph({ kind: 'none' })
    let live = true
    setParagraph({ kind: 'writing' })
    buddy
      .summaryModel()
      .then((model) => writeSummary(model, latest.current))
      .catch(() => null)
      .then((text) => {
        if (live) setParagraph(text ? { kind: 'done', text } : { kind: 'failed' })
      })
    return () => {
      live = false
    }
  }, [buddy, canWrite, dataKey])

  return (
    <section className={`${card} space-y-4`} aria-labelledby="grownups-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="grownups-heading" ref={heading} tabIndex={-1} className="text-2xl font-extrabold text-purple focus:outline-none">
          For grown-ups
        </h2>
        <button type="button" className={softBtn} onClick={onClose}>
          Close
        </button>
      </div>

      <p className="text-lg font-bold">
        Ideas passed: {summary.passed} of {summary.total}
      </p>

      <div>
        <h3 className="text-xl font-extrabold">Most common mistakes</h3>
        {summary.mistakes.length === 0 ? (
          <p className="text-lg">No mistakes recorded yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-lg">
            {summary.mistakes.map((m) => (
              <li key={m.code}>
                {m.text} ({m.count} {m.count === 1 ? 'time' : 'times'})
              </li>
            ))}
          </ul>
        )}
      </div>

      {summary.scores.length > 0 && (
        <div>
          <h3 className="text-xl font-extrabold">Last test scores</h3>
          <ul className="mt-2 space-y-1 text-lg">
            {summary.scores.map((s, i) => (
              <li key={i}>
                {s.correct} out of {s.outOf}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div role="status" aria-live="polite" className="text-lg">
        {paragraph.kind === 'writing' && <p>Writing a summary on this device…</p>}
        {paragraph.kind === 'done' && (
          <div className="rounded-xl bg-teal-soft px-4 py-3">
            <p className="font-extrabold">
              <span className="rounded-full bg-white px-3 py-1 text-sm text-purple">🔒 Written on this device</span>
            </p>
            <p className="mt-2">{paragraph.text}</p>
          </div>
        )}
        {paragraph.kind === 'failed' && <p className="text-sm">{SUMMARY_FAILED}</p>}
        {paragraph.kind === 'none' && summary.mistakes.length > 0 && <p className="text-sm">{NO_NANO_NOTE}</p>}
      </div>
    </section>
  )
}
