/**
 * The main menu's colours, a leaf with no imports: the drawing code (the animated palette strip in gfx and frames) reads them, and
 * menu-style.ts, which reaches the pages, re-exports them. Each is a step of the xterm 256-colour cube or its grey ramp
 * (tests/menu-style.spec.ts holds that, and the contrast of the ink on each accent).
 */
/** The ink on an accent's solid bar, and the muted ink for a badge that is only information. */
export const INK = '#1c1c1c'
export const MUTED = '#8a8a8a'
export const LOUD = '#ffaf00'

/** One accent per menu group, by the group's title. */
export const ACCENT: Readonly<Record<string, string>> = {
  SWARM: '#ffaf00',
  INTELLIGENCE: '#5fd7ff',
  'SAFETY & OPS': '#ff5f5f',
  'NETWORK & EXTEND': '#5fd75f',
  TOOLS: '#d787ff',
}

/** The palette strip above the groups: the accents in menu order. */
export const PALETTE: readonly string[] = ['#ffaf00', '#5fd7ff', '#ff5f5f', '#5fd75f', '#d787ff']

/** `#rrggbb` as the 0xRRGGBB number a Grid takes. */
export const rgb = (hex: string): number => Number.parseInt(hex.slice(1), 16)

/**
 * The accent of a page's nav group. The menu names its groups one way (INTELLIGENCE, SAFETY & OPS) and the nav another (MIND, SAFETY),
 * so this maps the nav's names to the same five colours: a page's cards and section rules wear the accent of the group the menu
 * lists it under.
 */
export const NAV_ACCENT: Readonly<Record<string, string>> = {
  SWARM: ACCENT.SWARM as string,
  MIND: ACCENT.INTELLIGENCE as string,
  SAFETY: ACCENT['SAFETY & OPS'] as string,
  NETWORK: ACCENT['NETWORK & EXTEND'] as string,
  TOOLS: ACCENT.TOOLS as string,
}

/** The colour of a mission's status line, by tone: running and done green, ready amber, paused cyan, waiting dim. */
export const TONE = { live: '#5fd75f', ready: '#ffaf00', wait: '#8a8a8a', done: '#5fd75f', paused: '#5fd7ff' } as const
