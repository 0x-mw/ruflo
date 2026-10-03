/**
 * The BBS boot screen, played for the first seconds after the pane opens: a modem dials and connects, then the RuFlo
 * neon sign strikes up tube by tube on its brick wall (gfx/neon.ts), then a handshake line and a bar that fills with
 * the first ruflo reads, and under them a boot log that brings every area of the console online, one line at a time,
 * for as many rows as the pane has (it scrolls when the pane is short). The sign and the modem are decoration and end by
 * themselves; the log is not, when the self-check's results are passed: an area shows [ OK ] only if its check passed, and
 * [FAIL] with the first problem if not, so what the screen claims is what was verified.
 */
import type { BootCheck } from '../boot-checks'
import type { BootFacts } from '../boot-facts'
import { drawCyber } from './boot-cyber'
import { neonPicture, NEON_ROWS } from './neon'
import { Grid } from './raster'

const SIGN_TOP = 2
export const BOOT_ROWS = SIGN_TOP + NEON_ROWS + 3

const GREEN = 0x39ff14
const CYAN = 0x05d9e8
const PINK = 0xff2a6d
const DIM = 0x6b7280
/** The sign is switched on once the line connects. */
const SIGN_ON_MS = 900
/** The boot log starts once the handshake is typed, and brings one area online every LOG_MS_PER. */
const LOG_FROM_MS = 1500
const LOG_MS_PER = 120

/** Every area of the console, in menu order: what the boot log brings online. */
export const BOOT_MODULES: readonly { name: string; note: string }[] = [
  { name: 'Missions', note: 'goal → SPARC plan → tasks' },
  { name: 'Overview', note: 'subsystems, health, Optimizer' },
  { name: 'Swarm', note: 'topology, agents, tasks' },
  { name: 'Hive-Mind', note: 'queen, workers, votes, quorum' },
  { name: 'Claims', note: 'one owner per resource' },
  { name: 'Approvals', note: 'votes and asks in one place' },
  { name: 'Automation', note: 'workflows, workers, autopilot' },
  { name: 'Learning', note: 'SONA, MoE, EWC++ pulse' },
  { name: 'Neural', note: 'pretrain, patterns, routing' },
  { name: 'Vector Lab', note: 'HNSW, RaBitQ, RVF' },
  { name: 'Memory Lab', note: 'AgentDB, embeddings' },
  { name: 'MetaHarness', note: 'readiness, flywheel, lab' },
  { name: 'Self-Evolution', note: 'governed receipts, lineage' },
  { name: 'Security', note: 'scans, AIDefence, doctor' },
  { name: 'Federation', note: 'peers, trust, relay' },
  { name: 'x.ruv.io', note: 'swarm board, AgentBBS rooms' },
  { name: 'Plugins & Mods', note: 'every ruflo plugin mapped' },
  { name: 'Skills', note: 'find, add, manage' },
  { name: 'Plugin Catalog', note: 'every plugin, mod and skill' },
  { name: 'Dev Tools', note: 'ADRs, SPARC, tests, git, docs' },
  { name: 'Cost & Budget', note: 'spend, burn, limits' },
  { name: 'Timeline', note: 'who was busy, and when' },
  { name: 'Events', note: 'what changed, live' },
  { name: 'Performance', note: 'metrics and bottlenecks' },
  { name: 'AI Terminal', note: 'ruflo, codex, claude' },
  { name: 'Settings', note: 'every option a button' },
]
const NAME_WIDTH = 15

/**
 * `age` is ms since the pane opened; the bar mixes elapsed time with the reads that have answered (`done` of
 * `total`), so it moves before any read returns and reads 100% before the boot ends at BOOT_MIN_MS. `rows` is the
 * pane's body height when it is known: the boot log fills what is left under the sign (0: the sign alone).
 */
export function bootPicture(project: string, columns: number, age: number, done: number, total: number, rows = 0, checks?: readonly BootCheck[], facts?: BootFacts): Grid {
  const height = Math.max(BOOT_ROWS, rows)
  const grid = new Grid(columns, height)
  const type = (y: number, from: number, text: string, color: number, msPerChar = 22) => {
    if (age < from) return

    grid.text(0, y, text.slice(0, Math.min(text.length, Math.floor((age - from) / msPerChar), columns)), color)
  }

  type(0, 0, `ATDT ruflo.local${age >= 450 ? '   RING… RING…' : ''}`, DIM, 18)
  type(1, 600, 'CONNECT 115200 / ARQ / V.42bis', GREEN, 12)

  // The sign's wall shows from the start, unlit; the tubes strike from SIGN_ON_MS.
  const sign = neonPicture(columns, age - SIGN_ON_MS, true)

  grid.cells.set(sign.cells, SIGN_TOP * columns * 3)

  type(BOOT_ROWS - 2, 1300, `> handshake ok · node ${project}`, CYAN, 14)

  // The boot log: one area comes online every LOG_MS_PER, [ .. ] while it starts and [ OK ] once the next one has begun; the
  // newest lines stay in view when the pane is shorter than the list, and READY closes it.
  // With the self-check's results the log is a report: READY counts what was verified, and an area that failed says why. Without
  // them (nothing has run the check) it draws as it always did.
  const failedAreas = checks === undefined ? 0 : BOOT_MODULES.filter(entry => checks.find(result => result.area === entry.name)?.ok === false).length
  const readyNote = checks === undefined ? `${BOOT_MODULES.length} areas online · press a key or click` : `${BOOT_MODULES.length - failedAreas} of ${BOOT_MODULES.length} areas verified${failedAreas > 0 ? ` · ${failedAreas} failed` : ''} · press a key or click`
  const entries = [...BOOT_MODULES.map(entry => ({ ...entry, ready: false })), { name: 'READY', note: readyNote, ready: true }]
  const room = height - BOOT_ROWS - 1
  const started = age < LOG_FROM_MS ? 0 : Math.min(entries.length, Math.floor((age - LOG_FROM_MS) / LOG_MS_PER) + 1)
  const logProgress = started / entries.length

  // With the machine's facts and room for it, the log is the cyberpunk uplink (boot-cyber.ts); otherwise the plain list below.
  const isCyber = facts !== undefined && age >= LOG_FROM_MS - 200 && drawCyber(grid, facts, BOOT_MODULES, checks, age, BOOT_ROWS + 1, room)

  if (!isCyber && room > 0 && started > 0) {
    const first = Math.max(0, started - room)

    for (let i = first; i < started; i++) {
      const entry = entries[i] as (typeof entries)[number]
      const y = BOOT_ROWS + 1 + (i - first)
      const isOn = i < started - 1 || started === entries.length

      if (entry.ready) {
        grid.text(0, y, failedAreas > 0 ? `[FAIL] ${entry.name}` : `[ OK ] ${entry.name}`, failedAreas > 0 ? PINK : GREEN)
        grid.text(7 + 'READY '.length, y, entry.note.slice(0, Math.max(0, columns - 13)), PINK)
      } else {
        // An area that is on has its verdict: [ OK ] only if its check passed; [FAIL] and the first problem, if it did not.
        const problem = isOn ? checks?.find(result => result.area === entry.name && !result.ok)?.problems[0] : undefined

        grid.text(0, y, problem !== undefined ? '[FAIL]' : isOn ? '[ OK ]' : '[ .. ]', problem !== undefined ? PINK : isOn ? GREEN : CYAN)
        grid.text(7, y, entry.name.padEnd(NAME_WIDTH).slice(0, NAME_WIDTH), 0xe6e6e6)
        grid.text(7 + NAME_WIDTH + 1, y, (problem ?? entry.note).slice(0, Math.max(0, columns - 7 - NAME_WIDTH - 1)), problem !== undefined ? PINK : DIM)
      }
    }
  }

  // LOADING [▓▓▓▓░░░░] 58%  reads 6/10, with a blinking cursor while it runs.
  if (age >= 1300) {
    const pct = Math.min(1, 0.4 * Math.min(1, (age - 1300) / 3300) + 0.3 * logProgress + 0.3 * (total > 0 ? done / total : 1))
    const barWidth = Math.max(6, Math.min(24, columns - 30))
    const filled = Math.round(pct * barWidth)
    const line = `LOADING [${'▓'.repeat(filled)}${'░'.repeat(barWidth - filled)}] ${String(Math.round(pct * 100)).padStart(3)}%  reads ${done}/${total}`

    grid.text(0, BOOT_ROWS - 1, line.slice(0, columns), pct >= 1 ? GREEN : CYAN)
    if (Math.floor(age / 400) % 2 === 0 && line.length + 1 < columns) grid.set(line.length + 1, BOOT_ROWS - 1, '█', CYAN)
  }

  return grid
}
