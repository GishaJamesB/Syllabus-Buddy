import { createRng } from './rng'
import { areaTemplates } from './templates/area'
import { perimeterTemplates } from './templates/perimeter'
import type { Difficulty, Question, QuestionDraft, Template, Topic } from './types'

const TEMPLATES: Template[] = [...perimeterTemplates, ...areaTemplates]

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

export function listTemplates(topic?: Topic): Template[] {
  return topic ? TEMPLATES.filter((t) => t.topic === topic) : [...TEMPLATES]
}

function mistakesAreDistinct(draft: QuestionDraft): boolean {
  const values = draft.mistakes.map((m) => m.value)
  return !values.includes(draft.answer.value) && new Set(values).size === values.length
}

export function generate(id: string, difficulty: Difficulty, seed: number): Question {
  const template = getTemplate(id)
  if (!template) throw new Error(`Unknown template: ${id}`)
  const rng = createRng(seed)
  let draft = template.generate(rng, difficulty)
  for (let i = 0; i < 100 && !mistakesAreDistinct(draft); i++) draft = template.generate(rng, difficulty)
  return {
    ...draft,
    id: `${id}:${difficulty}:${seed}`,
    templateId: id,
    topic: template.topic,
    difficulty,
    seed,
  }
}
