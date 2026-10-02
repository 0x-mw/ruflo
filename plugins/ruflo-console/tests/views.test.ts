import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { HIVE_TOKEN, RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, fakeRuflo, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

const HOME_FILES = {
  '.claude/plugins/installed_plugins.json': JSON.stringify({
    version: 2,
    plugins: {
      'ruflo-core@ruflo': [{ scope: 'user', version: '0.2.6', lastUpdated: '2026-07-30T12:06:11.791Z' }],
      'ruflo-swarm@ruflo': [{ scope: 'user', version: '0.2.1' }],
    },
  }),
  '.claude/plugins/known_marketplaces.json': JSON.stringify({ ruflo: { installLocation: '/home/dev/.claude/plugins/marketplaces/ruflo', lastUpdated: '2026-09-03T18:45:31.282Z', autoUpdate: true } }),
  '.claude/plugins/marketplaces/ruflo/.claude-plugin/marketplace.json': JSON.stringify({ name: 'ruflo', plugins: [{ name: 'ruflo-core' }, { name: 'ruflo-swarm' }] }),
}

/** Opens the console on `view` and answers its drawing once the probes for that view have run. */
async function drawn($: Parameters<TestBody>[0], view: string, columns = 110) {
  await $.command.run(command(view))
  await $.command.run(command('status'))

  return mountedText($, columns)
}

async function mountedText($: Parameters<TestBody>[0], columns: number) {
  const pane = await $.ui.mount({ ...paneAt(columns), plugin: PLUGIN })
  const tree = await pane.drawn()

  await pane.unmount()

  return { text: textOf(tree), tree }
}

describe('views', () => {
  test('overview: every subsystem from disk, the CLI or the engine, the activity raster, nothing invented', async ($, on) => {
    fakeRuflo().register(on, {})
    worldOf(on, RUFLO_FILES, { home: HOME_FILES })
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, tree } = await drawn($, 'overview')

    expect(text).toContain('v3.50.0 (npx-offline)')
    expect(text).toContain('running per daemon-state.json')
    expect(text).toContain('2 ruflo tools callable now')
    expect(text).toContain('1 entries')
    expect(text).toContain('manifest v3.32.24')
    expect(text).toContain('signature not checked here')
    expect(text).toContain('seated · policy observe · routed 4')
    expect(text).toContain('swarm-1790903031804-y9rnjr · hierarchical · running · 2 agents')
    expect(elementsOf(tree, 'Raster').map(keyOf)).toEqual(['activity'])
  })

  test('swarms: the topology graph, agents, the hive with its proposal, and no hive token', async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, tree } = await drawn($, 'swarm')

    expect(elementsOf(tree, 'Raster').map(keyOf)).toEqual(['topology'])
    expect(text).toContain('hierarchical · specialized · running · max 6')
    expect(text).toMatch(/coder\s+coder\s+idle/)
    expect(text).toContain('design (raft) pending · for 0 · against 0')
    expect(text).toContain('/ruflo-swarm-pane')
    expect(text).not.toContain(HIVE_TOKEN)
  })

  test('claims: the board with a stealable claim, TTL bars, and the act row', async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, tree } = await drawn($, 'claims')

    expect(text).toContain('1 active · 1 stealable · 0 handoff')
    expect(text).toContain('console-demo-1')
    expect(text).toMatch(/console-demo-2.*stealable/)
    expect(text).toContain('no claims tool sets a TTL today')
    expect(elementsOf(tree, 'Raster').map(keyOf)).toEqual(['claims'])
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['claim', 'release', 'handoff', 'steal', 'agent-next']))
  })

  test('federation: local identity and channels, the relay never asked while the network option is off', async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text } = await drawn($, 'federation')

    expect(text).toContain('agentbbs agentbbs-not-found')
    expect(text).toContain('no channels joined')
    expect(text).toContain('Off: the roster is on the public relay')
    expect(world.runs.some(argv => argv.join(' ').includes('x_federation_roster'))).toBe(false)
  })

  test('plugins: a marketplace clone that does not list ruflo-mods reads STALE with the fix named', async ($, on) => {
    worldOf(on, RUFLO_FILES, { home: HOME_FILES })
    mock.clock(on)
    await $.session.start(SESSION)

    const { text } = await drawn($, 'plugins')

    expect(text).toContain('STALE: the clone does not list ruflo-mods')
    expect(text).toContain('/plugin marketplace update ruflo')
    expect(text).toContain('2 ruflo · 1 enabled · 2 total')
    expect(text).toContain('✓ core 0.2.6')
  })

  test('learning: the last route, the outcome rate with its N, the curve, SONA counts', async ($, on) => {
    fakeRuflo().register(on, {})
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, tree } = await drawn($, 'learning')

    expect(text).toContain('tester 60% · keyword match')
    expect(text).toMatch(/\d+\/9 succeeded \(\d+% success rate, N=9\)/)
    expect(text).toContain('30.8k')
    expect(elementsOf(tree, 'Raster').map(keyOf)).toEqual(['curve'])
  })

  test('metaharness: the five scores, the flywheel ledger and the active policy', async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, tree } = await drawn($, 'metaharness')

    expect(elementsOf(tree, 'Raster').map(keyOf)).toEqual(['score'])
    expect(text).toContain('$0.024')
    expect(text).toContain('valid · 0 commits · 0 receipts')
    expect(text).toContain('none promoted')
  })

  test('memory: entries, a namespace sample, spend and the budget ladder from ruflo-mods', async ($, on) => {
    fakeRuflo().register(on, {})
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text } = await drawn($, 'memory')

    expect(text).toContain('1 · 0 with vectors')
    expect(text).toMatch(/console\s+█+ 1/)
    expect(text).toContain('$0.421')
    expect(text).toContain('WARNING · $3.90 of $5.00 (78%)')
  })
})
