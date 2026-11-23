import { describe, expect, it } from 'vitest'
import { describeError } from './describeError'

describe('describeError', () => {
  it('labels errors with an appCheck/ code', () => {
    const e = Object.assign(new Error('boom'), { code: 'appCheck/recaptcha-error' })
    expect(describeError(e)).toContain('App Check failed')
  })

  it('labels messages mentioning app check', () => {
    expect(describeError(new Error('AppCheck token invalid'))).toContain('App Check failed')
  })

  it('leaves token-limit and generic 403 errors alone', () => {
    expect(describeError(new Error('token limit exceeded'))).toBe('token limit exceeded')
    expect(describeError(new Error('403 Forbidden'))).toBe('403 Forbidden')
  })
})
