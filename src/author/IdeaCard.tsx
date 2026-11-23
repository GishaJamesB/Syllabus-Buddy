import { DIFFICULTIES, templateIds, type Idea, type LessonIssue, type LessonDifficulty, type TemplateRef } from '../content/lessonSchema'
import { Diagram } from '../diagrams/Diagram'
import { generate } from '../maths/registry'
import { formatAnswer } from '../maths/types'

interface Props {
  idea: Idea
  index: number
  total: number
  issues: LessonIssue[]
  onChange: (idea: Idea) => void
  onMove: (delta: -1 | 1) => void
  onDelete: () => void
  canDelete: boolean
}

const field = 'w-full rounded-xl border-2 border-purple/40 bg-white px-3 py-2 text-base focus:border-purple focus:outline-none'
const smallBtn =
  'rounded-full bg-purple-soft px-4 py-2 text-sm font-bold text-purple hover:bg-purple hover:text-white disabled:opacity-40 disabled:hover:bg-purple-soft disabled:hover:text-purple'

function TemplatePicker({ label, value, onChange }: { label: string; value: TemplateRef; onChange: (v: TemplateRef) => void }) {
  const ids = templateIds()
  const options = ids.includes(value.templateId) ? ids : [value.templateId, ...ids]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="w-36 text-sm font-bold">{label}</label>
      <select
        aria-label={`${label} question type`}
        className={`${field} w-auto`}
        value={value.templateId}
        onChange={(e) => onChange({ ...value, templateId: e.target.value })}
      >
        {options.map((id) => (
          <option key={id} value={id}>
            {ids.includes(id) ? id : `${id} (not supported)`}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} difficulty`}
        className={`${field} w-auto`}
        value={value.difficulty}
        onChange={(e) => onChange({ ...value, difficulty: e.target.value as LessonDifficulty })}
      >
        {DIFFICULTIES.map((d) => (
          <option key={d}>{d}</option>
        ))}
      </select>
    </div>
  )
}

function Preview({ ref_, showDiagram }: { ref_: TemplateRef; showDiagram: boolean }) {
  let q
  try {
    q = generate(ref_.templateId, ref_.difficulty, 1)
  } catch {
    const known = templateIds().includes(ref_.templateId)
    return <p className="text-sm text-danger">{known ? 'No preview: pick a supported difficulty.' : 'No preview: pick a supported question type.'}</p>
  }
  return (
    <div className="rounded-xl bg-teal-soft p-4">
      <p className="text-sm font-bold text-teal">Worked example preview (seed 1)</p>
      <p className="mt-1">{q.prompt}</p>
      <ol className="mt-2 list-decimal pl-5 text-sm">
        {q.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <p className="mt-2 font-bold">Answer: {formatAnswer(q.answer)}</p>
      {showDiagram && (
        <div className="mt-2 max-w-xs text-ink">
          <Diagram spec={q.diagram} />
        </div>
      )}
    </div>
  )
}

export function IdeaCard({ idea, index, total, issues, onChange, onMove, onDelete, canDelete }: Props) {
  const set = (patch: Partial<Idea>) => onChange({ ...idea, ...patch })
  const ids = templateIds()
  return (
    <article className="rounded-card bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-extrabold text-orange">Idea {index + 1}</h2>
        <div className="flex gap-2">
          <button className={smallBtn} disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move idea ${index + 1} up`}>
            Up
          </button>
          <button className={smallBtn} disabled={index === total - 1} onClick={() => onMove(1)} aria-label={`Move idea ${index + 1} down`}>
            Down
          </button>
          <button className="rounded-full bg-danger-soft px-4 py-2 text-sm font-bold text-danger hover:bg-danger hover:text-white disabled:opacity-40 disabled:hover:bg-danger-soft disabled:hover:text-danger" disabled={!canDelete} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      {issues.map((it, i) => (
        <p
          key={i}
          role={it.level === 'error' ? 'alert' : 'status'}
          className={`mt-3 rounded-xl px-3 py-2 text-sm font-bold ${it.level === 'error' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-ink'}`}
        >
          {it.level === 'error' ? 'Error: ' : 'Warning: '}
          {it.message}
        </p>
      ))}

      <div className="mt-4 space-y-3">
        <label className="block text-sm font-bold">
          Title
          <input className={field} value={idea.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="block text-sm font-bold">
          Explanation
          <textarea className={field} rows={4} value={idea.explanation} onChange={(e) => set({ explanation: e.target.value })} />
        </label>
        <label className="block text-sm font-bold">
          Key points (one per line)
          <textarea
            className={field}
            rows={3}
            value={idea.keyPoints.join('\n')}
            onChange={(e) => set({ keyPoints: e.target.value.split('\n') })}
            onBlur={() => set({ keyPoints: idea.keyPoints.map((k) => k.trim()).filter(Boolean) })}
          />
        </label>
        <TemplatePicker label="Worked example" value={idea.workedExample} onChange={(workedExample) => set({ workedExample })} />
        <TemplatePicker label="Check question" value={idea.checkQuestion} onChange={(checkQuestion) => set({ checkQuestion })} />
        <fieldset>
          <legend className="text-sm font-bold">Practice question types</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {ids.map((id) => (
              <label key={id} className="flex items-center gap-1 rounded-full bg-orange-soft px-3 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={idea.practiceTemplates.includes(id)}
                  onChange={(e) =>
                    set({
                      practiceTemplates: e.target.checked
                        ? [...idea.practiceTemplates, id]
                        : idea.practiceTemplates.filter((t) => t !== id),
                    })
                  }
                />
                {id}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={idea.diagram} onChange={(e) => set({ diagram: e.target.checked })} />
          Show a diagram
        </label>
        <Preview ref_={idea.workedExample} showDiagram={idea.diagram} />
      </div>
    </article>
  )
}
