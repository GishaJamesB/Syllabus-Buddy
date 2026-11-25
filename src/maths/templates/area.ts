import type { Template } from '../types'
import { distinctPair, len, range, side } from './common'

const areaRectangle: Template = {
  id: 'area_rectangle',
  topic: 'area',
  generate(rng, d) {
    const [l, b] = distinctPair(rng, d)
    const unit = range(d).area
    return {
      prompt: `A rectangle is ${len(l, d)} long and ${len(b, d)} wide. What is its area?`,
      dims: [l, b],
      numbers: { length: l, breadth: b },
      answer: { value: l * b, unit },
      steps: [
        'Area of a rectangle = length × breadth.',
        `Area = ${l} × ${b} = ${l * b}.`,
        `The area is ${l * b} ${unit}.`,
      ],
      diagram: {
        kind: 'rectangle',
        width: l,
        height: b,
        labels: { width: len(l, d), height: len(b, d) },
      },
      mistakes: [
        { value: l + b, code: 'area_added_not_multiplied' },
        { value: 2 * (l + b), code: 'perim_area_confused' },
      ],
    }
  },
}

const areaSquare: Template = {
  id: 'area_square',
  topic: 'area',
  generate(rng, d) {
    const s = side(rng, d)
    const unit = range(d).area
    return {
      prompt: `A square has a side of ${len(s, d)}. What is its area?`,
      dims: [s],
      numbers: { side: s },
      answer: { value: s * s, unit },
      steps: [
        'Area of a square = side × side.',
        `Area = ${s} × ${s} = ${s * s}.`,
        `The area is ${s * s} ${unit}.`,
      ],
      diagram: { kind: 'square', side: s, labels: { side: len(s, d) } },
      mistakes: [
        { value: s + s, code: 'area_added_not_multiplied' },
        { value: 4 * s, code: 'perim_area_confused' },
      ],
    }
  },
}

const areaMissingSideRectangle: Template = {
  id: 'area_missing_side_rectangle',
  topic: 'area',
  generate(rng, d) {
    const [l, b] = distinctPair(rng, d)
    const a = l * b
    const unit = range(d).length
    return {
      prompt: `The area of a rectangle is ${a} ${range(d).area}. One side is ${len(l, d)}. What is the other side?`,
      dims: [l, b],
      numbers: { area: a, side: l },
      answer: { value: b, unit },
      steps: [
        'Area = length × breadth, so the other side = area ÷ known side.',
        `Other side = ${a} ÷ ${l} = ${b}.`,
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

const areaUncovered: Template = {
  id: 'area_uncovered',
  topic: 'area',
  generate(rng, d) {
    const { min, max } = range(d)
    const w = rng.int(2 * min, max)
    const h = rng.int(2 * min, max)
    const inner = rng.int(min, Math.floor(Math.min(w, h) / 2))
    const [whole, piece] = d === 'hard' ? ['room floor', 'carpet'] : ['card', 'sticker']
    const outer = w * h
    const covered = inner * inner
    const unit = range(d).area
    return {
      prompt: `A rectangular ${whole} is ${len(w, d)} by ${len(h, d)}. A square ${piece} of side ${len(inner, d)} is placed on it. What is the area of the ${whole} left uncovered?`,
      dims: [w, h, inner],
      numbers: { length: w, breadth: h, inner },
      answer: { value: outer - covered, unit },
      steps: [
        `Area of the ${whole} = ${w} × ${h} = ${outer}.`,
        `Area of the ${piece} = ${inner} × ${inner} = ${covered}.`,
        `Uncovered area = ${outer} − ${covered} = ${outer - covered}.`,
        `The uncovered area is ${outer - covered} ${unit}.`,
      ],
      diagram: {
        kind: 'rectangle_inner_square',
        width: w,
        height: h,
        inner,
        labels: { width: len(w, d), height: len(h, d), inner: len(inner, d) },
      },
      mistakes: [],
    }
  },
}

const areaLShape: Template = {
  id: 'area_l_shape',
  topic: 'area',
  generate(rng, d) {
    const { min, max } = range(d)
    const cw = rng.int(min, max - min)
    const w = rng.int(cw + min, max)
    const ch = rng.int(min, max - min)
    const h = rng.int(ch + min, max)
    const left = (w - cw) * h
    const right = cw * (h - ch)
    const unit = range(d).area
    return {
      prompt: `An L-shaped figure is cut from a ${len(w, d)} by ${len(h, d)} rectangle by removing a ${len(cw, d)} by ${len(ch, d)} corner. What is its area?`,
      dims: [w, h, cw, ch, w - cw, h - ch],
      numbers: { width: w, height: h, cutWidth: cw, cutHeight: ch },
      answer: { value: left + right, unit },
      steps: [
        `Split the shape into two rectangles. Left part: ${w - cw} × ${h} = ${left}.`,
        `Right part: ${cw} × ${h - ch} = ${right}.`,
        `Area = ${left} + ${right} = ${left + right}.`,
        `The area is ${left + right} ${unit}.`,
      ],
      diagram: {
        kind: 'l_shape',
        width: w,
        height: h,
        notchWidth: cw,
        notchHeight: ch,
        labels: {
          width: len(w, d),
          height: len(h, d),
          notchWidth: len(cw, d),
          notchHeight: len(ch, d),
        },
      },
      mistakes: [
        { value: left, code: 'rectilinear_missed_edge' },
        { value: right, code: 'rectilinear_missed_edge' },
      ],
    }
  },
}

const areaTriangleHalfRectangle: Template = {
  id: 'area_triangle_half_rectangle',
  topic: 'area',
  generate(rng, d) {
    let base: number, h: number
    do {
      base = side(rng, d)
      h = side(rng, d)
    } while ((base * h) % 2 !== 0)
    const unit = range(d).area
    return {
      prompt: `A right-angled triangle has a base of ${len(base, d)} and a height of ${len(h, d)}. It is half of a rectangle. What is its area?`,
      dims: [base, h],
      numbers: { base, height: h },
      answer: { value: (base * h) / 2, unit },
      steps: [
        `The rectangle is ${base} × ${h} = ${base * h}.`,
        `The triangle is half of it: ${base * h} ÷ 2 = ${(base * h) / 2}.`,
        `The area is ${(base * h) / 2} ${unit}.`,
      ],
      diagram: {
        kind: 'triangle_in_rectangle',
        base,
        height: h,
        labels: { base: len(base, d), height: len(h, d) },
      },
      mistakes: [
        { value: base + h, code: 'area_added_not_multiplied' },
      ],
    }
  },
}

export const areaTemplates: Template[] = [
  areaRectangle,
  areaSquare,
  areaMissingSideRectangle,
  areaUncovered,
  areaLShape,
  areaTriangleHalfRectangle,
]
