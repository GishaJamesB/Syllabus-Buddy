import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { generate, listTemplates } from '../maths/registry'
import { diagramLabels, type Difficulty } from '../maths/types'
import { Diagram } from './Diagram'

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']

describe('Diagram', () => {
  for (const t of listTemplates()) {
    for (const d of DIFFICULTIES) {
      it(`${t.id} ${d} draws every label and no NaN`, () => {
        for (let seed = 0; seed < 200; seed++) {
          const q = generate(t.id, d, seed)
          const svg = renderToStaticMarkup(<Diagram spec={q.diagram} />)
          expect(svg).not.toContain('NaN')
          const known = new Set([...q.dims, ...Object.values(q.numbers)])
          for (const label of diagramLabels(q.diagram)) {
            expect(svg).toContain(`>${label}</text>`)
            if (label !== '?') expect(known.has(Number.parseInt(label, 10))).toBe(true)
          }
        }
      })
    }
  }
})
