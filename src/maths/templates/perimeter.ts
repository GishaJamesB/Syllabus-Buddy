import type { Template } from '../types'
import { distinctPair, len, range, side } from './common'

const perimRectangle: Template = {
  id: 'perim_rectangle',
  topic: 'perimeter',
  generate(rng, d) {
    const [l, b] = distinctPair(rng, d)
    const p = 2 * (l + b)
    const unit = range(d).length
    return {
      prompt: `A rectangle is ${len(l, d)} long and ${len(b, d)} wide. What is its perimeter?`,
      dims: [l, b],
      numbers: { length: l, breadth: b },
      answer: { value: p, unit },
      steps: [
        'Perimeter of a rectangle = 2 × (length + breadth).',
        `Length + breadth = ${l} + ${b} = ${l + b}.`,
        `Perimeter = 2 × ${l + b} = ${p}.`,
        `The perimeter is ${p} ${unit}.`,
      ],
      diagram: {
        kind: 'rectangle',
        width: l,
        height: b,
        labels: { width: len(l, d), height: len(b, d) },
      },
      mistakes: [
        { value: l + b, code: 'perim_two_sides_only' },
        { value: l * b, code: 'perim_area_confused' },
      ],
    }
  },
}

const perimSquare: Template = {
  id: 'perim_square',
  topic: 'perimeter',
  generate(rng, d) {
    const s = side(rng, d)
    const p = 4 * s
    const unit = range(d).length
    return {
      prompt: `A square has a side of ${len(s, d)}. What is its perimeter?`,
      dims: [s],
      numbers: { side: s },
      answer: { value: p, unit },
      steps: [
        'Perimeter of a square = 4 × side.',
        `Perimeter = 4 × ${s} = ${p}.`,
        `The perimeter is ${p} ${unit}.`,
      ],
      diagram: { kind: 'square', side: s, labels: { side: len(s, d) } },
      mistakes: [
        { value: s, code: 'square_side_vs_perimeter' },
        { value: s * s, code: 'perim_area_confused' },
      ],
    }
  },
}

const perimTriangle: Template = {
  id: 'perim_triangle',
  topic: 'perimeter',
  generate(rng, d) {
    const { min, max } = range(d)
    let a: number, b: number, c: number
    do {
      a = rng.int(min, max)
      b = rng.int(min, max)
      c = rng.int(min, max)
    } while (a + b <= c || a + c <= b || b + c <= a)
    const p = a + b + c
    const unit = range(d).length
    return {
      prompt: `The sides of a triangle are ${len(a, d)}, ${len(b, d)} and ${len(c, d)}. What is its perimeter?`,
      dims: [a, b, c],
      numbers: { a, b, c },
      answer: { value: p, unit },
      steps: [
        'Perimeter of a triangle = sum of its three sides.',
        `Perimeter = ${a} + ${b} + ${c} = ${p}.`,
        `The perimeter is ${p} ${unit}.`,
      ],
      diagram: { kind: 'triangle', a, b, c, labels: { a: len(a, d), b: len(b, d), c: len(c, d) } },
      mistakes: [{ value: a + b, code: 'perim_two_sides_only' }],
    }
  },
}

const perimRegularPolygon: Template = {
  id: 'perim_regular_polygon',
  topic: 'perimeter',
  generate(rng, d) {
    const n = rng.pick([5, 6, 8])
    const s = side(rng, d)
    const p = n * s
    const unit = range(d).length
    return {
      prompt: `A regular polygon has ${n} equal sides, each ${len(s, d)} long. What is its perimeter?`,
      dims: [s],
      numbers: { sides: n, side: s },
      answer: { value: p, unit },
      steps: [
        'Perimeter of a regular polygon = number of sides × length of one side.',
        `Perimeter = ${n} × ${s} = ${p}.`,
        `The perimeter is ${p} ${unit}.`,
      ],
      diagram: { kind: 'regular_polygon', sides: n, side: s, labels: { side: len(s, d) } },
      mistakes: [],
    }
  },
}

const perimMissingSideRectangle: Template = {
  id: 'perim_missing_side_rectangle',
  topic: 'perimeter',
  generate(rng, d) {
    const [l, b] = distinctPair(rng, d)
    const p = 2 * (l + b)
    const unit = range(d).length
    return {
      prompt: `The perimeter of a rectangle is ${len(p, d)}. One side is ${len(l, d)}. What is the other side?`,
      dims: [l, b],
      numbers: { perimeter: p, side: l },
      answer: { value: b, unit },
      steps: [
        'Length + breadth = perimeter ÷ 2.',
        `Length + breadth = ${p} ÷ 2 = ${p / 2}.`,
        `Other side = ${p / 2} − ${l} = ${b}.`,
        `The other side is ${b} ${unit}.`,
      ],
      diagram: {
        kind: 'rectangle',
        width: l,
        height: b,
        labels: { width: len(l, d), height: '?' },
      },
      mistakes: [],
    }
  },
}

const perimMissingSideSquare: Template = {
  id: 'perim_missing_side_square',
  topic: 'perimeter',
  generate(rng, d) {
    const s = side(rng, d)
    const p = 4 * s
    const unit = range(d).length
    return {
      prompt: `The perimeter of a square is ${len(p, d)}. What is the length of one side?`,
      dims: [s],
      numbers: { perimeter: p },
      answer: { value: s, unit },
      steps: [
        'Side of a square = perimeter ÷ 4.',
        `Side = ${p} ÷ 4 = ${s}.`,
        `The side is ${s} ${unit}.`,
      ],
      diagram: { kind: 'square', side: s, labels: { side: '?' } },
      mistakes: [{ value: p, code: 'square_side_vs_perimeter' }],
    }
  },
}

const perimFencingCost: Template = {
  id: 'perim_fencing_cost',
  topic: 'perimeter',
  generate(rng, d) {
    const [l, b] = distinctPair(rng, d)
    const rate = rng.pick([5, 10, 20, 25, 50])
    const p = 2 * (l + b)
    return {
      prompt: `A rectangular field is ${l} m long and ${b} m wide. Fencing costs S$${rate} per metre. What is the total cost of fencing all around it?`,
      dims: [l, b],
      numbers: { length: l, breadth: b, rate },
      answer: { value: p * rate, unit: 'S$' },
      steps: [
        'Fencing goes all around, so first find the perimeter.',
        `Perimeter = 2 × (${l} + ${b}) = ${p}.`,
        `Cost = perimeter × rate = ${p} × ${rate} = ${p * rate}.`,
        `The total cost is S$${p * rate}.`,
      ],
      diagram: {
        kind: 'rectangle',
        width: l,
        height: b,
        labels: { width: `${l} m`, height: `${b} m` },
      },
      mistakes: [
        { value: (l + b) * rate, code: 'perim_two_sides_only' },
        { value: l * b * rate, code: 'perim_area_confused' },
      ],
    }
  },
}

export const perimeterTemplates: Template[] = [
  perimRectangle,
  perimSquare,
  perimTriangle,
  perimRegularPolygon,
  perimMissingSideRectangle,
  perimMissingSideSquare,
  perimFencingCost,
]
