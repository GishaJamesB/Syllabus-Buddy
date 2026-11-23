import type { ReactNode } from 'react'
import { diagramLabels, type DiagramSpec } from '../maths/types'

const KIND_NAMES: Record<DiagramSpec['kind'], string> = {
  rectangle: 'Rectangle',
  square: 'Square',
  triangle: 'Triangle',
  regular_polygon: 'Regular polygon',
  l_shape: 'L-shaped figure',
  rectangle_inner_square: 'Rectangle with a square inside',
  triangle_in_rectangle: 'Right-angled triangle drawn in a rectangle',
}

const VIEW_W = 320
const VIEW_H = 240
const BOX = { x: 50, y: 34, w: 220, h: 160 }
const MIN_PX = 36

function fit(w: number, h: number) {
  const s = Math.min(BOX.w / w, BOX.h / h)
  const pw = Math.max(w * s, MIN_PX)
  const ph = Math.max(h * s, MIN_PX)
  const k = Math.min(1, BOX.w / pw, BOX.h / ph)
  const fw = pw * k
  const fh = ph * k
  return { w: fw, h: fh, x: BOX.x + (BOX.w - fw) / 2, y: BOX.y + (BOX.h - fh) / 2 }
}

function Label({ x, y, text, anchor = 'middle' }: { x: number; y: number; text: string; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={14} fill="currentColor">
      {text}
    </text>
  )
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2 } as const
const dashed = { fill: 'none', stroke: 'currentColor', strokeWidth: 1, strokeDasharray: '4 3' } as const

function Rect({ width, height, labels }: { width: number; height: number; labels: { width: string; height: string } }) {
  const r = fit(width, height)
  return (
    <>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} {...stroke} />
      <Label x={r.x + r.w / 2} y={r.y + r.h + 20} text={labels.width} />
      <Label x={r.x - 8} y={r.y + r.h / 2 + 5} text={labels.height} anchor="end" />
    </>
  )
}

function polygonPoints(pts: [number, number][]) {
  return pts.map(([x, y]) => `${x},${y}`).join(' ')
}

function Triangle({ a, b, c, labels }: { a: number; b: number; c: number; labels: { a: string; b: string; c: string } }) {
  const cx = (b * b + c * c - a * a) / (2 * c)
  const cy = Math.sqrt(Math.max(b * b - cx * cx, 0))
  const minX = Math.min(0, cx)
  const maxX = Math.max(c, cx)
  const s = Math.min(BOX.w / (maxX - minX), BOX.h / cy)
  const ph = Math.max(cy * s, MIN_PX)
  const x0 = BOX.x + (BOX.w - (maxX - minX) * s) / 2
  const y0 = BOX.y + (BOX.h + ph) / 2
  const A: [number, number] = [x0 - minX * s, y0]
  const B: [number, number] = [x0 + (c - minX) * s, y0]
  const C: [number, number] = [x0 + (cx - minX) * s, y0 - ph]
  return (
    <>
      <polygon points={polygonPoints([A, B, C])} {...stroke} />
      <Label x={(A[0] + B[0]) / 2} y={A[1] + 20} text={labels.c} />
      <Label x={(B[0] + C[0]) / 2 + 8} y={(B[1] + C[1]) / 2} text={labels.a} anchor="start" />
      <Label x={(A[0] + C[0]) / 2 - 8} y={(A[1] + C[1]) / 2} text={labels.b} anchor="end" />
    </>
  )
}

function RegularPolygon({ sides, labels }: { sides: number; labels: { side: string } }) {
  const R = 70
  const cx = VIEW_W / 2
  const cy = VIEW_H / 2
  const pts: [number, number][] = Array.from({ length: sides }, (_, i) => {
    const ang = Math.PI / 2 + (2 * Math.PI * i) / sides
    return [cx + R * Math.cos(ang), cy + R * Math.sin(ang)]
  })
  const [p0, p1] = pts
  return (
    <>
      <polygon points={polygonPoints(pts)} {...stroke} />
      <Label x={(p0[0] + p1[0]) / 2 + 16} y={(p0[1] + p1[1]) / 2 + 20} text={labels.side} anchor="start" />
    </>
  )
}

function LShape({
  width,
  height,
  notchWidth,
  notchHeight,
  labels,
}: Extract<DiagramSpec, { kind: 'l_shape' }>) {
  const s = Math.min(BOX.w / width, BOX.h / height)
  const parts = {
    a: Math.max((width - notchWidth) * s, MIN_PX),
    c: Math.max(notchWidth * s, MIN_PX),
    e: Math.max(notchHeight * s, MIN_PX),
    f: Math.max((height - notchHeight) * s, MIN_PX),
  }
  const k = Math.min(1, BOX.w / (parts.a + parts.c), BOX.h / (parts.e + parts.f))
  const a = parts.a * k
  const c = parts.c * k
  const e = parts.e * k
  const f = parts.f * k
  const W = a + c
  const H = e + f
  const x = BOX.x + (BOX.w - W) / 2
  const y = BOX.y + (BOX.h - H) / 2
  const pts: [number, number][] = [
    [x, y],
    [x + a, y],
    [x + a, y + e],
    [x + W, y + e],
    [x + W, y + H],
    [x, y + H],
  ]
  return (
    <>
      <polygon points={polygonPoints(pts)} {...stroke} />
      <path d={`M${x + a},${y} H${x + W} V${y + e}`} {...dashed} />
      <Label x={x + W / 2} y={y + H + 20} text={labels.width} />
      <Label x={x - 8} y={y + H / 2 + 5} text={labels.height} anchor="end" />
      <Label x={x + a + c / 2} y={y - 8} text={labels.notchWidth} />
      <Label x={x + W + 8} y={y + e / 2 + 5} text={labels.notchHeight} anchor="start" />
    </>
  )
}

function InnerSquare({
  width,
  height,
  inner,
  labels,
}: Extract<DiagramSpec, { kind: 'rectangle_inner_square' }>) {
  const r = fit(width, height)
  const s = Math.min(r.w, r.h) * (inner / Math.min(width, height))
  const side = Math.min(Math.max(s, MIN_PX), Math.min(r.w, r.h) - 8)
  const sx = r.x + (r.w - side) / 2
  const sy = r.y + (r.h - side) / 2
  return (
    <>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} {...stroke} />
      <rect x={sx} y={sy} width={side} height={side} {...stroke} strokeDasharray="4 3" />
      <Label x={r.x + r.w / 2} y={r.y + r.h + 20} text={labels.width} />
      <Label x={r.x - 8} y={r.y + r.h / 2 + 5} text={labels.height} anchor="end" />
      <Label x={sx + side / 2} y={sy + side / 2 + 5} text={labels.inner} />
    </>
  )
}

function TriangleInRectangle({
  base,
  height,
  labels,
}: Extract<DiagramSpec, { kind: 'triangle_in_rectangle' }>) {
  const r = fit(base, height)
  return (
    <>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} {...dashed} />
      <polygon
        points={polygonPoints([
          [r.x, r.y],
          [r.x, r.y + r.h],
          [r.x + r.w, r.y + r.h],
        ])}
        {...stroke}
      />
      <Label x={r.x + r.w / 2} y={r.y + r.h + 20} text={labels.base} />
      <Label x={r.x - 8} y={r.y + r.h / 2 + 5} text={labels.height} anchor="end" />
    </>
  )
}

function shape(spec: DiagramSpec): ReactNode {
  switch (spec.kind) {
    case 'rectangle':
      return <Rect width={spec.width} height={spec.height} labels={spec.labels} />
    case 'square':
      return <Rect width={spec.side} height={spec.side} labels={{ width: spec.labels.side, height: spec.labels.side }} />
    case 'triangle':
      return <Triangle a={spec.a} b={spec.b} c={spec.c} labels={spec.labels} />
    case 'regular_polygon':
      return <RegularPolygon sides={spec.sides} labels={spec.labels} />
    case 'l_shape':
      return <LShape {...spec} />
    case 'rectangle_inner_square':
      return <InnerSquare {...spec} />
    case 'triangle_in_rectangle':
      return <TriangleInRectangle {...spec} />
  }
}

export function Diagram({ spec }: { spec: DiagramSpec }) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width="100%"
      style={{ maxWidth: 360 }}
      role="img"
      aria-label={`${KIND_NAMES[spec.kind]}: ${diagramLabels(spec).join(', ')}`}
    >
      {shape(spec)}
    </svg>
  )
}
