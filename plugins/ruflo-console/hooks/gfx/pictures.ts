/**
 * Every animated picture the console draws, each a pure function of its data, its size and the real clock `t` (ms).
 * The render and every `$.ui.blit` frame call the same function with the same size, so a frame always fits the mounted
 * Raster. What motion means is said in the view beside each picture: data where it is data, decoration where it is not.
 */
import { Braille, COLOR, Grid, mix, ramp, sparkline } from './raster'

export type TopoNode = { id: string; label: string; status: string; isLeader: boolean }
export type TopoModel = { topology: string; nodes: TopoNode[] }

const isBusy = (status: string) => /busy|active|running|working/i.test(status)
const isDown = (status: string) => /stop|terminat|offline|dead|error|fail/i.test(status)

function nodeColor(node: TopoNode): number {
  if (node.isLeader) return COLOR.accent
  if (isDown(node.status)) return /error|fail/i.test(node.status) ? COLOR.bad : COLOR.dim
  if (isBusy(node.status)) return COLOR.warn

  return COLOR.info
}

/** Where each node sits, in braille dots, by topology: a tree for hierarchical and star, a circle for mesh and ring. */
export function layout(model: TopoModel, width: number, height: number): { x: number; y: number }[] {
  const n = model.nodes.length
  const isTree = /hier|star|queen/i.test(model.topology) && !/mesh/i.test(model.topology)
  const isHybrid = /hierarchical-mesh/i.test(model.topology)

  if (n === 0) {
    return []
  }

  if (isTree || isHybrid) {
    const workers = Math.max(1, n - 1)

    return model.nodes.map((node, i) =>
      i === 0 ? { x: width / 2, y: 3 } : { x: ((i - 0.5) / workers) * (width - 8) + 4, y: Math.max(8, height - 6) },
    )
  }

  const cx = width / 2
  const cy = height / 2
  const r = Math.max(4, Math.min(width / 2 - 6, height / 2 - 3))

  return model.nodes.map((_, i) => {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2

    return { x: cx + Math.cos(angle) * r * 1.6, y: cy + Math.sin(angle) * r }
  })
}

/** The edges a topology draws between node indexes. */
export function edges(model: TopoModel): [number, number][] {
  const n = model.nodes.length
  const out: [number, number][] = []
  const topology = model.topology.toLowerCase()

  if (n < 2) {
    return out
  }

  if (topology.includes('mesh') && !topology.includes('hierarchical')) {
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) out.push([a, b])
  } else if (topology.includes('ring')) {
    for (let a = 0; a < n; a++) out.push([a, (a + 1) % n])
  } else {
    for (let b = 1; b < n; b++) out.push([0, b])

    if (topology.includes('hierarchical-mesh')) {
      for (let a = 1; a < n - 1; a++) out.push([a, a + 1])
    }
  }

  return out.slice(0, 200)
}

/**
 * The swarm graph: nodes coloured by the status ruflo wrote, the leader in the accent colour, and pulses running from
 * the leader along each edge to an agent whose status is busy. With no busy agent, the leader only breathes: decoration.
 */
export function topologyPicture(model: TopoModel, columns: number, rows: number, t: number): Grid {
  const grid = new Grid(columns, rows)
  const canvas = new Braille(columns, rows)
  const points = layout(model, canvas.width, canvas.height)
  const links = edges(model)

  for (const [a, b] of links) {
    const p = points[a]
    const q = points[b]

    if (p !== undefined && q !== undefined) canvas.line(p.x, p.y, q.x, q.y, COLOR.line)
  }

  links.forEach(([a, b], i) => {
    const p = points[a]
    const q = points[b]
    const target = model.nodes[b]

    if (p === undefined || q === undefined || target === undefined || !isBusy(target.status)) {
      return
    }

    for (const lag of [0, 0.5]) {
      const k = (((t / 1400 + i * 0.13 + lag) % 1) + 1) % 1

      canvas.dot(p.x + (q.x - p.x) * k, p.y + (q.y - p.y) * k, COLOR.warn)
    }
  })

  canvas.blitInto(grid, 0, 0)

  points.forEach((point, i) => {
    const node = model.nodes[i]

    if (node === undefined) return

    const cx = Math.floor(point.x / 2)
    const cy = Math.floor(point.y / 4)
    const breath = node.isLeader ? 0.5 + 0.5 * Math.sin(t / 450) : 1
    const color = node.isLeader ? mix(COLOR.line, COLOR.accent, breath) : nodeColor(node)
    const label = node.label.slice(0, Math.max(3, Math.floor(columns / Math.max(2, model.nodes.length)) - 2))

    grid.set(cx, cy, node.isLeader ? '★' : '●', color)
    grid.text(Math.max(0, Math.min(columns - label.length, cx - Math.floor(label.length / 2))), Math.min(rows - 1, cy + 1), label, node.isLeader ? COLOR.accent : nodeColor(node))
  })

  return grid
}

/**
 * Two measured series as sparklines with their labels: tool calls the console saw per 5 s, and ruflo state files that
 * changed per refresh. The newest bar glows while the pane animates: decoration over measured bars.
 */
export function activityPicture(series: readonly { label: string; values: readonly number[] }[], columns: number, t: number): Grid {
  const grid = new Grid(columns, Math.max(1, series.length))
  const labelWidth = Math.min(18, Math.max(8, ...series.map(entry => entry.label.length + 1)))
  const width = Math.max(4, columns - labelWidth)

  series.forEach((entry, row) => {
    grid.text(0, row, entry.label.slice(0, labelWidth - 1), COLOR.dim)
    sparkline(grid, labelWidth, row, width, entry.values, v => ramp(0.3 + v * 0.7))

    const glow = 0.5 + 0.5 * Math.sin(t / 300)
    const last = labelWidth + width - 1

    if ((entry.values[entry.values.length - 1] ?? 0) > 0) {
      grid.set(last, row, grid.glyph(last, row), mix(COLOR.info, 0xffffff, glow * 0.6))
    }
  })

  return grid
}

/**
 * The running success rate of routed tasks (routing-outcomes.json), oldest left, as a braille line over a 0-100% frame.
 * A cursor walks the line: decoration, the line is the data.
 */
export function curvePicture(points: readonly boolean[], columns: number, rows: number, t: number): Grid {
  const grid = new Grid(columns, rows)
  const canvas = new Braille(columns - 5, rows)
  const n = points.length

  for (let r = 0; r < rows; r++) {
    grid.text(0, r, r === 0 ? '100%' : r === rows - 1 ? '  0%' : '    ', COLOR.dim)
  }

  if (n === 0) {
    grid.text(6, Math.floor(rows / 2), 'no routed outcomes on disk yet', COLOR.dim)

    return grid
  }

  let ok = 0
  const rates = points.map((point, i) => {
    ok += point ? 1 : 0

    return ok / (i + 1)
  })
  const xOf = (i: number) => (n === 1 ? canvas.width / 2 : (i / (n - 1)) * (canvas.width - 1))
  const yOf = (rate: number) => (1 - rate) * (canvas.height - 1)

  for (let x = 0; x < canvas.width; x += 4) canvas.dot(x, yOf(0.5), COLOR.line)

  for (let i = 1; i < n; i++) canvas.line(xOf(i - 1), yOf(rates[i - 1] as number), xOf(i), yOf(rates[i] as number), ramp(rates[i] as number))

  if (n === 1) canvas.dot(xOf(0), yOf(rates[0] as number), ramp(rates[0] as number))

  const cursor = Math.floor(((t / 120) % n) + n) % n

  canvas.dot(xOf(cursor), yOf(rates[cursor] as number), 0xffffff)
  canvas.blitInto(grid, 5, 0)

  return grid
}

/** A claim's bar: remaining time to `expiresAt` when ruflo set one, else its age on a 24 h scale. */
export type ClaimBar = { label: string; claimedAtMs?: number; expiresAtMs?: number; progress?: number; isStealable: boolean }

const DAY = 86_400_000

const span = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))

  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  if (s < 86_400) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`

  return `${Math.floor(s / 86_400)}d${Math.floor((s % 86_400) / 3600)}h`
}

/** One row per claim, counted on the real clock `nowMs`: a TTL counts down, an age counts up. Both are data. */
export function claimsPicture(bars: readonly ClaimBar[], columns: number, rows: number, nowMs: number): Grid {
  const grid = new Grid(columns, rows)
  const labelWidth = Math.min(22, Math.max(10, Math.floor(columns * 0.32)))
  const textWidth = 12
  const barWidth = Math.max(4, columns - labelWidth - textWidth - 1)

  bars.slice(0, rows).forEach((bar, row) => {
    grid.text(0, row, bar.label.slice(0, labelWidth - 1), bar.isStealable ? COLOR.warn : COLOR.info)

    const hasTtl = bar.expiresAtMs !== undefined && bar.claimedAtMs !== undefined && bar.expiresAtMs > bar.claimedAtMs
    const left = hasTtl ? (bar.expiresAtMs as number) - nowMs : 0
    const fraction = hasTtl
      ? Math.max(0, Math.min(1, left / ((bar.expiresAtMs as number) - (bar.claimedAtMs as number))))
      : bar.claimedAtMs === undefined
        ? 0
        : Math.max(0, Math.min(1, (nowMs - bar.claimedAtMs) / DAY))
    const filled = fraction * barWidth
    const color = hasTtl ? (fraction < 0.2 ? COLOR.bad : fraction < 0.5 ? COLOR.warn : COLOR.ok) : mix(COLOR.info, COLOR.warn, fraction)

    for (let i = 0; i < barWidth; i++) {
      const part = Math.max(0, Math.min(1, filled - i))

      grid.set(labelWidth + i, row, part >= 1 ? '█' : part > 0.5 ? '▌' : '·', part > 0 ? color : COLOR.line)
    }

    const words = hasTtl ? (left > 0 ? `ttl ${span(left)}` : 'ttl expired') : bar.claimedAtMs === undefined ? 'age n/a' : `age ${span(nowMs - bar.claimedAtMs)}`

    grid.text(labelWidth + barWidth + 1, row, words.slice(0, textWidth), hasTtl && left <= 0 ? COLOR.bad : COLOR.dim)
  })

  return grid
}

/** Score bars 0-100 that fill to their value over the first 700 ms after `sinceMs`, then hold: the fill is decoration. */
export function scorePicture(dims: readonly { name: string; value: number }[], columns: number, t: number, sinceMs: number): Grid {
  const grid = new Grid(columns, Math.max(1, dims.length))
  const labelWidth = 19
  const barWidth = Math.max(4, columns - labelWidth - 5)
  const grow = Math.max(0, Math.min(1, (t - sinceMs) / 700))
  const eased = 1 - (1 - grow) ** 3

  dims.forEach((dim, row) => {
    grid.text(0, row, dim.name.slice(0, labelWidth - 1), COLOR.dim)

    const filled = (dim.value / 100) * barWidth * eased

    for (let i = 0; i < barWidth; i++) {
      const part = Math.max(0, Math.min(1, filled - i))

      grid.set(labelWidth + i, row, part >= 1 ? '█' : part > 0.5 ? '▌' : '·', part > 0 ? ramp(dim.value / 100) : COLOR.line)
    }

    grid.text(labelWidth + barWidth + 1, row, String(Math.round(dim.value)).padStart(3), ramp(dim.value / 100))
  })

  return grid
}

/** The band's mark: a diamond that pulses while Claude works and rests otherwise. */
export function markPicture(isWorking: boolean, t: number): Grid {
  const grid = new Grid(2, 1)
  const k = isWorking ? 0.5 + 0.5 * Math.sin(t / 220) : 1

  grid.set(0, 0, '◆', isWorking ? mix(COLOR.line, COLOR.accent, k) : COLOR.accent)

  return grid
}
