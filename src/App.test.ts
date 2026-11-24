import { describe, expect, it } from 'vitest'
import { routeFor } from './App'

describe('routeFor', () => {
  it('sends the root and unknown paths to the learner app', () => {
    expect(routeFor('/')).toBe('learner')
    expect(routeFor('/foo/')).toBe('learner')
  })
  it('ignores trailing slashes for diagnostics', () => {
    expect(routeFor('/diagnostics')).toBe('diagnostics')
    expect(routeFor('/diagnostics/')).toBe('diagnostics')
  })
  it('opens author mode in dev', () => {
    expect(import.meta.env.DEV).toBe(true)
    expect(routeFor('/author')).toBe('author')
  })
})
