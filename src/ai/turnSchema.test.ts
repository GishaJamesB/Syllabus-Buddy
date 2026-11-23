import { describe, expect, it } from 'vitest'
import { parseTurn } from './turnSchema'

describe('parseTurn', () => {
  it('accepts a valid turn', () => {
    const r = parseTurn('{"intent":"answer_attempt","misconception":null,"clue":"Check your units"}')
    expect(r).toEqual({
      ok: true,
      turn: { intent: 'answer_attempt', misconception: null, clue: 'Check your units' },
    })
  })

  it('rejects an intent outside the enum', () => {
    const r = parseTurn('{"intent":"chat","misconception":null,"clue":null}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('schema_mismatch')
  })

  it('rejects missing fields', () => {
    const r = parseTurn('{"intent":"needs_clue"}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('schema_mismatch')
  })

  it('rejects an off-list misconception', () => {
    const r = parseTurn('{"intent":"needs_clue","misconception":"made_up","clue":null}')
    expect(r.ok).toBe(false)
  })

  it('accepts a listed misconception', () => {
    const r = parseTurn('{"intent":"needs_clue","misconception":"units_missing","clue":null}')
    expect(r.ok).toBe(true)
  })

  it('rejects extra keys', () => {
    const r = parseTurn('{"intent":"needs_clue","misconception":null,"clue":null,"extra":1}')
    expect(r.ok).toBe(false)
  })

  it('rejects a number-typed clue', () => {
    const r = parseTurn('{"intent":"needs_clue","misconception":null,"clue":5}')
    expect(r.ok).toBe(false)
  })

  it.each(['null', '[]', '5'])('rejects non-object JSON %s as schema_mismatch', (t) => {
    const r = parseTurn(t)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('schema_mismatch')
  })

  it('rejects non-JSON text and keeps the raw text', () => {
    const r = parseTurn('answer_attempt|null|hi')
    expect(r).toEqual({ ok: false, error: 'not_json', raw: 'answer_attempt|null|hi' })
  })
})
