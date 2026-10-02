/**
 * The BBS boot screen, played for the first seconds after the pane opens: a modem dials and connects, then RUFLO
 * materialises as big ANSI block art out of an animated ASCII field (the image-to-ASCII effect, done here in cells:
 * an ordered dither decides when each cell resolves, noise characters flicker in the cells still resolving, and a
 * plasma of dim characters moves behind). Then a handshake line and a bar that fills with the first ruflo reads.
 * The boot is the one animation in the console that is decoration; it ends by itself.
 */
import { bigText } from './font'
import { Grid, mix } from './raster'

export const BOOT_ROWS = 14

const MAGENTA = 0xff2a6d
const CORAL = 0xff7a59
const CYAN = 0x05d9e8
const GREEN = 0x39ff14
const DIM = 0x6b7280
const SHADOW = 0x4a1030
const PLASMA = [0x2a1038, 0x3d1450, 0x5a1a66] as const
const NOISE = '.:-=+*#%@'
const FIELD = ' ·:░'
/** 4x4 ordered-dither thresholds: the order in which the logo's cells resolve. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const

/** The logo as a pixel mask: the two-row half-block font, each cell two pixels tall. */
function logoMask(word: string): boolean[][] {
  const [top, bottom] = bigText(word)
  const rows: boolean[][] = [[], [], [], []]

  for (const [i, line] of [top, bottom].entries()) {
    for (const ch of line) {
      rows[i * 2]?.push(ch === '█' || ch === '▀')
      rows[i * 2 + 1]?.push(ch === '█' || ch === '▄')
    }
  }

  return rows
}

const MASK = logoMask('RUFLO')
const MASK_W = MASK[0]?.length ?? 0
/** Each mask pixel is drawn as a 2x2 block of cells. */
const SCALE = 2
export const LOGO_COLUMNS = MASK_W * SCALE
const LOGO_TOP = 3
const LOGO_ROWS = MASK.length * SCALE

const hash = (x: number, y: number, k: number): number => (Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663) ^ Math.imul(k, 83_492_791)) >>> 0
const isOn = (cx: number, cy: number): boolean => MASK[Math.floor(cy / SCALE)]?.[Math.floor(cx / SCALE)] === true

/**
 * `age` is ms since the pane opened; the bar mixes elapsed time with the reads that have answered (`done` of
 * `total`), so it moves before any read returns and reads 100% before the boot ends at BOOT_MIN_MS.
 */
export function bootPicture(project: string, columns: number, age: number, done: number, total: number): Grid {
  const grid = new Grid(columns, BOOT_ROWS)
  const type = (y: number, from: number, text: string, color: number, msPerChar = 22) => {
    if (age < from) return

    grid.text(0, y, text.slice(0, Math.min(text.length, Math.floor((age - from) / msPerChar), columns)), color)
  }

  type(0, 0, `ATDT ruflo.local${age >= 450 ? '   RING… RING…' : ''}`, DIM, 18)
  type(1, 700, 'CONNECT 115200 / ARQ / V.42bis', GREEN, 12)

  const left = Math.max(0, Math.floor((Math.min(columns, LOGO_COLUMNS + 26) - LOGO_COLUMNS - 26) / 2))
  const frame = Math.floor(age / 70)
  // Resolve runs 0..1 from 0.9 s to 2.4 s; the plasma fades out from 2.6 s so the finished logo stands clean.
  const resolve = Math.max(0, Math.min(1, (age - 900) / 1500))
  const fieldFade = age < 900 ? Math.max(0, (age - 300) / 600) : age < 2600 ? 1 : Math.max(0, 1 - (age - 2600) / 600)
  const glint = ((age / 24) % (LOGO_COLUMNS + 30)) - 10

  if (age >= 300) {
    for (let cy = 0; cy < LOGO_ROWS; cy++) {
      for (let cx = 0; cx < Math.min(LOGO_COLUMNS + 2, columns - left); cx++) {
        const x = left + cx
        const y = LOGO_TOP + cy

        if (isOn(cx, cy)) {
          // Each cell resolves when the sweep plus its dither threshold passes it; just before, it flickers as noise.
          const at = (BAYER[(cy % 4) * 4 + (cx % 4)] as number) / 16 * 0.55 + (cx / LOGO_COLUMNS) * 0.45
          const gap = resolve - at

          if (gap >= 0) {
            const base = mix(mix(MAGENTA, CORAL, cy / (LOGO_ROWS - 1)), CYAN, cx / LOGO_COLUMNS * 0.55)
            const shine = Math.max(0, 1 - Math.abs(cx - glint) / 3)

            grid.set(x, y, gap < 0.06 ? '▓' : '█', mix(base, 0xffffff, shine * 0.65))
          } else if (gap > -0.25) {
            grid.set(x, y, NOISE[hash(cx, cy, frame) % NOISE.length] as string, mix(CYAN, MAGENTA, (hash(cy, cx, frame) % 100) / 100))
          } else if (fieldFade > 0) {
            grid.set(x, y, '·', mix(0x000000, PLASMA[0], fieldFade))
          }
        } else if (isOn(cx - 1, cy - 1) && resolve - ((cx - 1) / LOGO_COLUMNS) * 0.45 > 0.35) {
          // A drop shadow down and right of the resolved letters, the way ANSI title screens set their logos off.
          grid.set(x, y, '░', SHADOW)
        } else if (fieldFade > 0) {
          const v = Math.sin(cx * 0.33 + age / 300) + Math.sin(cy * 0.9 - age / 230) + Math.sin((cx + cy) * 0.18 + age / 410)
          const k = Math.max(0, Math.min(FIELD.length - 1, Math.floor(((v + 3) / 6) * FIELD.length)))

          if (k > 0) grid.set(x, y, FIELD[k] as string, mix(0x000000, PLASMA[k - 1] as number, fieldFade))
        }
      }
    }
  }

  const tagX = left + LOGO_COLUMNS + 3

  if (age >= 1700 && columns >= tagX + 12) {
    grid.text(tagX, LOGO_TOP + 1, '░▒▓ AGENT SWARM'.slice(0, columns - tagX), MAGENTA)
    grid.text(tagX, LOGO_TOP + 2, '    CONSOLE'.slice(0, columns - tagX), CORAL)
    grid.text(tagX, LOGO_TOP + 4, 'x.ruv.io'.slice(0, columns - tagX), CYAN)
    grid.text(tagX, LOGO_TOP + 5, 'AGENTS WELCOME.'.slice(0, columns - tagX), GREEN)
  }

  type(BOOT_ROWS - 3, 2200, `> handshake ok · node ${project}`, CYAN, 14)

  // LOADING [▓▓▓▓░░░░] 58%  reads 6/10, with a blinking cursor while it runs.
  if (age >= 2200) {
    const pct = Math.min(1, 0.55 * Math.min(1, (age - 2200) / 800) + 0.45 * (total > 0 ? done / total : 1))
    const barWidth = Math.max(6, Math.min(24, columns - 30))
    const filled = Math.round(pct * barWidth)
    const line = `LOADING [${'▓'.repeat(filled)}${'░'.repeat(barWidth - filled)}] ${String(Math.round(pct * 100)).padStart(3)}%  reads ${done}/${total}`

    grid.text(0, BOOT_ROWS - 2, line.slice(0, columns), pct >= 1 ? GREEN : CYAN)
    if (Math.floor(age / 400) % 2 === 0 && line.length + 1 < columns) grid.set(line.length + 1, BOOT_ROWS - 2, '█', CYAN)
  }

  return grid
}
