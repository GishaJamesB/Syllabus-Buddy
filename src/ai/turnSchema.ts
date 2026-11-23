export const INTENTS = ['answer_attempt', 'needs_clue', 'review_previous', 'off_topic'] as const
export type Intent = (typeof INTENTS)[number]

export const MISCONCEPTIONS = [
  'perim_two_sides_only',
  'perim_area_confused',
  'area_added_not_multiplied',
  'units_missing',
  'units_wrong_power',
  'square_side_vs_perimeter',
  'rectilinear_missed_edge',
] as const

export interface Turn {
  intent: Intent
  misconception: string | null
  clue: string | null
}

export type ParseResult =
  | { ok: true; turn: Turn }
  | { ok: false; error: 'not_json' | 'schema_mismatch'; raw: string }

export const turnJsonSchema = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: [...INTENTS] },
    misconception: { enum: [...MISCONCEPTIONS, null] },
    clue: { type: ['string', 'null'] },
  },
  required: ['intent', 'misconception', 'clue'],
  additionalProperties: false,
} as const

export function parseTurn(text: string): ParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, error: 'not_json', raw: text }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'schema_mismatch', raw: text }
  }
  const v = value as Record<string, unknown>
  const allowed = ['intent', 'misconception', 'clue']
  if (
    Object.keys(v).some((k) => !allowed.includes(k)) ||
    !(INTENTS as readonly string[]).includes(v.intent as string) ||
    !(v.misconception === null || (MISCONCEPTIONS as readonly string[]).includes(v.misconception as string)) ||
    !(v.clue === null || typeof v.clue === 'string')
  ) {
    return { ok: false, error: 'schema_mismatch', raw: text }
  }
  return {
    ok: true,
    turn: {
      intent: v.intent as Intent,
      misconception: v.misconception as string | null,
      clue: v.clue as string | null,
    },
  }
}
