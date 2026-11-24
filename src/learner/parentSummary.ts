import { withTimeout, type TurnModel } from '../ai/buddy'
import { MISCONCEPTIONS } from '../ai/turnSchema'
import type { Lesson } from '../content/lessonSchema'
import type { MistakeCode } from '../maths/types'
import { mistakeText } from './mistakeText'
import { mistakeHistory, type Profile } from './progress'
import { finishedTests, score } from './test'

export const SUMMARY_TIMEOUT_MS = 10_000
export const SUMMARY_MAX = 400
export const TOP_MISTAKES = 3
export const RECENT_SCORES = 3

export interface ParentSummary {
  title: string
  passed: number
  total: number
  mistakes: { code: MistakeCode; text: string; count: number }[]
  scores: { correct: number; outOf: number }[]
}

export function parentSummary(profile: Profile, lesson: Lesson): ParentSummary {
  const ideaIds = new Set(lesson.ideas.map((i) => i.id))
  const counts = mistakeHistory(profile)
  const mistakes = (Object.entries(counts) as [MistakeCode, number][])
    .filter(([, count]) => count > 0)
    .sort(([a, x], [b, y]) => y - x || MISCONCEPTIONS.indexOf(a) - MISCONCEPTIONS.indexOf(b))
    .slice(0, TOP_MISTAKES)
    .map(([code, count]) => ({ code, text: mistakeText[code], count }))
  return {
    title: lesson.title,
    passed: profile.progress.passedIdeaIds.filter((id) => ideaIds.has(id)).length,
    total: lesson.ideas.length,
    mistakes,
    scores: finishedTests(profile.progress, RECENT_SCORES).map((t) => ({ correct: score(t), outOf: t.questions.length })),
  }
}

type PromptData = Pick<ParentSummary, 'title' | 'mistakes' | 'scores'>

export function summaryPrompt(summary: PromptData): string {
  const scores = summary.scores.length
    ? summary.scores.map((s) => `${s.correct} out of ${s.outOf}`).join(', ')
    : 'no tests taken yet'
  return [
    `Write one short paragraph to a parent about their child learning "${summary.title}".`,
    'Use plain, kind words and stay under 80 words. Do not use the child’s name. Suggest one thing to practise together.',
    'Mistakes the child made most often, with how many times:',
    ...summary.mistakes.map((m) => `- ${m.text}: ${m.count}`),
    `Recent test scores, newest first: ${scores}.`,
  ].join('\n')
}

export async function writeSummary(
  model: TurnModel,
  summary: PromptData,
  timeoutMs = SUMMARY_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const { response } = await withTimeout(model.generateContent(summaryPrompt(summary)), timeoutMs)
    const text = response.text().trim()
    return text === '' || text.length > SUMMARY_MAX ? null : text
  } catch {
    return null
  }
}
