/**
 * The Hive-Mind picture: a honeycomb of flat-topped hex cells, the queen's crown in the centre and her workers in rings
 * around her, then one meter per open proposal. Each cell's glyph says the worker's role and its colour its liveness;
 * its walls say how it voted on the picked proposal (green for, pink against, yellow excluded as Byzantine).
 *
 * Motion means data: a cell flashes for HIVE_PULSE_MS after the console sees that worker vote, join or leave, and is
 * still otherwise, so with no fresh event every frame is the same. Colours are on the xterm-256 cube, which is what
 * Claude Code draws a Raster in where the terminal has no true colour. The size depends only on the model and the
 * columns, never on the clock, so every animation frame fits the Raster as mounted.
 */
import { HIVE_PULSE_MS } from '../data/hive'
import { Grid } from './raster'

/** xterm-256 cube colours: pink, yellow, cyan, green, magenta, and the greys. */
export const HIVE_COLOR = { pink: 0xd7005f, yellow: 0xd7af00, cyan: 0x00afd7, green: 0x5fd75f, magenta: 0xd700d7, white: 0xffffff, grey: 0x808080, wall: 0x585858, faint: 0x3a3a3a } as const

export type HiveCell = {
  id: string
  /** One glyph: ♛ the queen, ● worker, ◆ specialist, ▲ scout, ○ not in any store. */
  glyph: string
  /** Up to three characters under the glyph's right: the short id. */
  tag: string
  color: number
  /** The wall colour for its ballot on the picked proposal; absent when it has not voted. */
  vote?: 'for' | 'against' | 'byzantine'
  pulseAtMs?: number
}

export type HiveMeter = { label: string; votesFor: number; votesAgainst: number; required: number; nodes: number; note: string; isPicked: boolean }

export type HivePictureModel = { queen: HiveCell; members: HiveCell[]; meters: HiveMeter[] }

/** A cell is 6 columns by 3 rows; neighbouring columns of cells step 5 across and 1 down, so walls are shared. */
const CELL_W = 6
const STEP_X = 5
const TOP = ' ▁▁▁▁ '
const MID = '╱    ╲'
const BOTTOM = '╲▁▁▁▁╱'
/** Axial steps for flat-topped hexes that walk a ring clockwise from its top cell. */
const CLOCKWISE: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
]
export const MAX_RINGS = 4
const MAX_METERS = 5

/** Cells a honeycomb of `rings` rings holds, the centre included: 1, 7, 19, 37, 61. */
export const cellsIn = (rings: number): number => 1 + 3 * rings * (rings + 1)

/** The rings drawn: enough for every member where the width allows, at most MAX_RINGS. */
export function ringsFor(members: number, columns: number): number {
  const fits = Math.max(0, Math.min(MAX_RINGS, Math.floor((columns - CELL_W) / (STEP_X * 2))))
  let rings = 0

  while (rings < fits && cellsIn(rings) < members + 1) rings += 1

  return rings
}

/** Axial coordinates of every cell, centre first, then ring by ring, each clockwise from the top. */
export function spiral(rings: number): [number, number][] {
  const out: [number, number][] = [[0, 0]]

  for (let k = 1; k <= rings; k++) {
    let q = 0
    let r = -k

    for (const [dq, dr] of CLOCKWISE) {
      for (let step = 0; step < k; step++) {
        out.push([q, r])
        q += dq
        r += dr
      }
    }
  }

  return out
}

/** The top-left corner of a cell, for a honeycomb of `rings` rings centred in `columns`. */
export function cellOrigin(q: number, r: number, rings: number, columns: number): { x: number; y: number } {
  return { x: Math.floor(columns / 2) - Math.floor(CELL_W / 2) + q * STEP_X, y: 2 * rings + 2 * r + q }
}

export const hiveRows = (model: HivePictureModel, columns: number): number => {
  const meters = Math.min(MAX_METERS, model.meters.length)

  return 4 * ringsFor(model.members.length, columns) + 3 + (meters > 0 ? meters + 1 : 0)
}

/** Draws only the non-space characters of `text`, so a cell never blanks the wall its neighbour shares. */
function ink(grid: Grid, x: number, y: number, text: string, color: number): void {
  ;[...text].forEach((ch, i) => {
    if (ch !== ' ') grid.set(x + i, y, ch, color)
  })
}

/** Whether a cell is mid-pulse at `t`, and then which half of its blink. */
function pulseOf(cell: HiveCell, t: number): { isLit: boolean; isPulsing: boolean } {
  const age = cell.pulseAtMs === undefined ? -1 : t - cell.pulseAtMs

  if (age < 0 || age >= HIVE_PULSE_MS) return { isLit: false, isPulsing: false }

  return { isLit: Math.floor(age / 250) % 2 === 0, isPulsing: true }
}

const VOTE_WALL = { for: HIVE_COLOR.green, against: HIVE_COLOR.pink, byzantine: HIVE_COLOR.yellow } as const

function drawCell(grid: Grid, cell: HiveCell, x: number, y: number, t: number, isQueen: boolean): void {
  const pulse = pulseOf(cell, t)
  const wall = pulse.isLit ? HIVE_COLOR.white : cell.vote !== undefined ? VOTE_WALL[cell.vote] : isQueen ? HIVE_COLOR.magenta : HIVE_COLOR.wall

  ink(grid, x, y, TOP, wall)
  ink(grid, x, y + 1, MID, wall)
  ink(grid, x, y + 2, BOTTOM, wall)

  // The interior is cleared first, then the glyph and the tag; a pulse lights the glyph with the walls.
  grid.text(x + 1, y + 1, '    ')
  grid.set(x + 1, y + 1, cell.glyph, pulse.isLit ? HIVE_COLOR.white : cell.color)
  grid.text(x + 2, y + 1, cell.tag.slice(0, 3), pulse.isPulsing ? HIVE_COLOR.white : isQueen ? HIVE_COLOR.magenta : HIVE_COLOR.grey)
}

/** A proposal's bar: green votes for, pink against, the rest faint, and a yellow tick where the quorum falls. */
function drawMeter(grid: Grid, meter: HiveMeter, y: number, columns: number): void {
  const label = `${meter.isPicked ? '▸' : ' '}${meter.label}`.slice(0, 14).padEnd(15)
  const width = Math.max(8, Math.min(32, columns - label.length - 34))
  const cells = (votes: number) => Math.round((Math.min(votes, meter.nodes) / Math.max(1, meter.nodes)) * width)
  const forCells = cells(meter.votesFor)
  const againstCells = Math.min(width - forCells, cells(meter.votesAgainst))
  const tick = Math.min(width - 1, Math.max(0, cells(meter.required) - 1))

  grid.text(0, y, label, meter.isPicked ? HIVE_COLOR.white : HIVE_COLOR.grey)

  for (let i = 0; i < width; i++) {
    const color = i < forCells ? HIVE_COLOR.green : i < forCells + againstCells ? HIVE_COLOR.pink : HIVE_COLOR.faint
    const isTick = i === tick && i >= forCells + againstCells

    grid.set(label.length + i, y, isTick ? '┃' : i < forCells + againstCells ? '█' : '░', isTick ? HIVE_COLOR.yellow : color)
  }

  grid.text(label.length + width + 1, y, `${meter.votesFor}/${meter.required} for · ${meter.votesAgainst} against${meter.note === '' ? '' : ` · ${meter.note}`}`.slice(0, Math.max(0, columns - label.length - width - 1)), meter.isPicked ? HIVE_COLOR.cyan : HIVE_COLOR.grey)
}

export function hivePicture(model: HivePictureModel, columns: number, t: number): Grid {
  const rings = ringsFor(model.members.length, columns)
  const grid = new Grid(columns, hiveRows(model, columns))
  const slots = spiral(rings)
  const cells = [model.queen, ...model.members]

  // Drawn back to front, the queen last, so her magenta walls stay whole where they meet a worker's.
  slots.slice(0, cells.length).reverse().forEach(([q, r], back) => {
    const i = Math.min(slots.length, cells.length) - 1 - back
    const cell = cells[i]
    const { x, y } = cellOrigin(q, r, rings, columns)

    if (cell !== undefined) drawCell(grid, cell, x, y, t, i === 0)
  })

  const hidden = cells.length - slots.length

  if (hidden > 0) grid.text(Math.max(0, columns - 14), 4 * rings + 2, `+${hidden} more`.slice(0, 14), HIVE_COLOR.grey)

  model.meters.slice(0, MAX_METERS).forEach((meter, i) => drawMeter(grid, meter, 4 * rings + 4 + i, columns))

  return grid
}
