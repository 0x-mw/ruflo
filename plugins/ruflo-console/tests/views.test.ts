import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { HIVE_FILES, RAFT_ID, WORKERS } from './fixtures/hive'
import { MISSION_OBSERVATION } from './fixtures/missions'
import { HIVE_TOKEN, RUFLO_FILES } from './fixtures/ruflo-run'
import { FIND_OUT, LS_GLOBAL } from './fixtures/skills'
import { cliAnswer, command, elementsOf, fakeRuflo, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

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

type Engine = Parameters<TestBody>[0]

/** Opens the console on `view` via /ruflo, waits for its probes, and answers its drawing and its Raster keys. */
async function drawn($: Engine, view: string, columns = 110) {
  await $.command.run(command(view))
  await $.command.run(command('status'))

  const pane = await $.ui.mount({ ...paneAt(columns), plugin: PLUGIN })
  const tree = await pane.drawn()

  await pane.unmount()

  return { text: textOf(tree), tree, rasters: elementsOf(tree, 'Raster').map(keyOf) }
}

describe('views', () => {
  test('overview: every subsystem from disk, the CLI or the engine, health alerts, the activity raster', { options: { boot: false } }, async ($, on) => {
    fakeRuflo().register(on, {})
    worldOf(on, RUFLO_FILES, { home: HOME_FILES })
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'overview')

    expect(rasters).toEqual(['header', 'title', 'activity'])
    expect(text).toContain('v3.50.0 (npx-offline)')
    expect(text).toContain('running per daemon-state.json')
    expect(text).toContain('1 ruflo server connected (plugin_ruflo-core_ruflo) · 2 tools callable now')
    expect(text).toContain('manifest v3.32.24')
    expect(text).toContain('seated · policy observe · routed 4')
    expect(text).toContain('swarm-1790903031804-y9rnjr · hierarchical · running · 2 agents')
    expect(text).toContain('marketplace clone stale: no ruflo-mods — /plugin marketplace update ruflo')
    expect(text).toContain('budget WARNING: $3.90 of $5.00')
  })

  test('swarm: the topology graph, selectable agents, the hive with its proposal, no hive token', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters, tree } = await drawn($, 'swarm')

    expect(rasters).toEqual(['header', 'title', 'topology'])
    expect(text).toContain('hierarchical · specialized · running · max 6')
    // One label per agent (no repeated type), then status; a short id instead of the full one.
    expect(text).toMatch(/▸● \ncoder\s+idle\s+tasks/)
    expect(text).toMatch(/· #[a-z0-9]{4,6}/)
    expect(text).toContain('design (raft) pending · for 0 · against 0')
    expect(text).not.toContain(HIVE_TOKEN)
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['agent-next', 'agent-prev', 'drill', 'palette', 'actions', 'open-hive']))
    // The Hive-Mind tab has no hotkey: every digit and letter is taken.
    const tabProps = (key: string) => (elementsOf(tree, 'Button').find(button => keyOf(button) === key) as { props?: Record<string, unknown> } | undefined)?.props

    expect(tabProps('tab-claims')?.hotkey).toBe('3')
    expect(tabProps('tab-hive')).toBeDefined()
    expect(tabProps('tab-hive')?.hotkey).toBeUndefined()
  })

  test('hive: the honeycomb, quorum and fault tolerance, proposals, workers, decisions, broadcasts, no token', { options: { boot: false } }, async ($, on) => {
    worldOf(on, HIVE_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters, tree } = await drawn($, 'hive')

    expect(rasters).toEqual(['header', 'title', 'hive'])
    expect(text).toContain('queen-1790903321632 · term 2')
    expect(text).toContain('raft · proposals vote raft')
    expect(text).toContain('tolerates 1 faulty of 3 (raft f < n/2)')
    expect(text).toContain('2 of 3 votes to pass (majority)')
    expect(text).toContain('3 · 1 busy · 1 idle · 0 down · 1 in no agent store')
    expect(text).toContain('▸◇ design (raft T2 · timed out) pending · for 1 · against 0')
    expect(text).toContain('need 2 of 3')
    expect(text).toContain(`a vote is cast as the next worker that has not voted: ${WORKERS[1]}`)
    expect(text).toContain('budget → rejected · for 1 · against 2 · bft · 1 byzantine')
    expect(text).toContain('[high] system: freeze the main branch')
    expect(text).toContain('propose: n/a — raft term 2 already has design')
    expect(text).not.toContain(HIVE_TOKEN)
    expect(elementsOf(tree, 'Input').map(keyOf)).toEqual(['hive-propose', 'hive-broadcast'])
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['hive-vote-yes', 'hive-vote-no', 'hive-spawn-worker']))
  })

  test('hive: a vote asks before it runs, then runs one fixed argv as the next worker on yes', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, HIVE_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('hive'))

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })
    const votes = () => world.runs.filter(argv => argv.includes('consensus'))

    await pane.press({ key: 'hive-vote-yes' })
    expect(textOf(await pane.drawn())).toContain(`Confirm: vote for design (${RAFT_ID}) as worker ${WORKERS[1]}?`)
    expect(votes()).toHaveLength(0)

    await pane.press({ key: 'confirm' })
    expect(votes()).toHaveLength(1)
    expect(votes()[0]?.slice(4)).toEqual(['hive-mind', 'consensus', '--action', 'vote', '--proposal-id', RAFT_ID, '--vote', 'yes', '--voter-id', WORKERS[1], '--format', 'json'])
    await pane.unmount()
  })

  test('claims: the flow diagram with lanes and rings, the board, and the act row', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters, tree } = await drawn($, 'claims')

    expect(rasters).toEqual(['header', 'title', 'flow'])
    expect(text).toContain('1 active · 1 stealable · 0 handoff')
    expect(text).toContain('no claims tool sets a TTL today')
    expect(text).toMatch(/console-demo-2.*stealable/)
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['claim', 'release', 'handoff', 'steal', 'agent-next', 'task-next']))
  })

  test('federation: the map, local identity and channels; the relay is never asked while the option is off', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'federation')

    expect(rasters).toEqual(['header', 'title', 'fedmap'])
    expect(text).toContain('agentbbs agentbbs-not-found')
    expect(text).toContain('Off: the roster is on the public relay')
    expect(world.runs.some(argv => argv.join(' ').includes('x_federation_roster'))).toBe(false)
  })

  test('plugins: the health matrix, and a clone without ruflo-mods reads STALE with the fix named', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES, { home: HOME_FILES })
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'plugins')

    expect(rasters).toEqual(['header', 'title', 'health'])
    expect(text).toContain('STALE: the clone does not list ruflo-mods')
    expect(text).toContain('2 ruflo · 1 enabled · 2 total')
  })

  test('learning: last route, outcome rate with its N, the curve, the four-stage pipeline, pattern growth', { options: { boot: false } }, async ($, on) => {
    fakeRuflo().register(on, {})
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'learning')

    expect(rasters).toEqual(['header', 'title', 'curve', 'pipeline', 'patterns'])
    expect(text).toContain('tester 60% · keyword match')
    expect(text).toMatch(/\d+\/9 succeeded \(\d+% success rate, N=9\)/)
    expect(text).toContain('consolidate: EWC consolidations')
  })

  test('metaharness: the radar, the audit trend, the flywheel ledger and the active policy', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'metaharness')

    expect(rasters).toEqual(['header', 'title', 'radar', 'trend'])
    expect(text).toContain('$0.024')
    expect(text).toContain('valid · 0 commits · 0 receipts')
  })

  test('metaharness lab: every verb by purpose with its cost tag and button; promote is a command, never a button', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    mock.clock(on)
    await $.session.start(SESSION)

    const { text, tree } = await drawn($, 'metaharness')
    const buttons = elementsOf(tree, 'Button').map(keyOf)

    expect(text).toMatch(/LAB · INSPECT/i)
    expect(text).toMatch(/LAB · EVOLVE & TEST/i)
    expect(text).toMatch(/ \$\$ \n REDBLUE JUDGED \.+/)
    expect(text).toContain('ruflo metaharness flywheel promote <receipt-id> --public-key <approved-ed25519.pem> --confirm')
    expect(text).toContain('nothing run yet')
    expect(buttons).toEqual(expect.arrayContaining(['lab-mh-genome', 'lab-mh-mcp-scan', 'lab-mh-audit', 'lab-mh-redblue-real', 'lab-mh-learn-run', 'lab-mh-flywheel-run']))
    expect(buttons.some(key => /promote/.test(key))).toBe(false)
    // Drawing the lab runs nothing but the view's own probes.
    expect(world.runs.some(argv => /genome|mcp-scan|redblue|evolve|learn/.test(argv.join(' ')))).toBe(false)
  })

  test('memory and cost: entries, a namespace sample; spend, the gauge, the ladder and the burn', { options: { boot: false } }, async ($, on) => {
    fakeRuflo().register(on, {})
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const memory = await drawn($, 'memory')

    expect(memory.text).toContain('1 · 0 with vectors')
    expect(memory.text).toMatch(/console\s+█+ 1/)

    const cost = await drawn($, 'cost')

    expect(cost.rasters).toEqual(['header', 'title', 'gauge', 'burn'])
    expect(cost.text).toContain('$0.421')
    expect(cost.text).toContain('WARNING · $3.90 of $5.00 (78%)')
  })

  test('timeline, approvals and events draw from what was seen; the drill-down opens an agent', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    expect((await drawn($, 'timeline')).rasters).toEqual(['header', 'title', 'gantt'])

    const approvals = await drawn($, 'approvals')

    expect(approvals.text).toContain('[proposal] hive-mind proposal: design (raft)')
    expect(approvals.text).toContain('[stealable] claim console-demo-2 offered for stealing')

    const store = JSON.parse(RUFLO_FILES['.claude-flow/agents/store.json'] ?? '{}') as { agents: Record<string, Record<string, unknown>> }

    ;(Object.values(store.agents)[1] as Record<string, unknown>).status = 'busy'
    world.put('.claude-flow/agents/store.json', JSON.stringify(store))
    await $.command.run(command('status'))
    expect((await drawn($, 'events')).text).toContain('agent tester: idle → busy')

    await $.command.run(command('agent tester'))

    const agent = await drawn($, 'agent agent-1790903032591-x41b0y')

    expect(agent.text).toContain('tester · tester')
    expect(agent.text).toContain('console-demo-2 stealable')
    expect(world.runs.some(argv => argv.join(' ').includes('agent logs --id agent-1790903032591-x41b0y --tail 20'))).toBe(true)
  })

  test('missions: the ADR-406 observation, task status as recorded, evidence as verified, nothing invented', { options: { boot: false } }, async ($, on) => {
    worldOf(on, { ...RUFLO_FILES, '.claude-flow/missions/observation.json': MISSION_OBSERVATION })
    mock.clock(on)
    await $.session.start(SESSION)

    const { text } = await drawn($, 'missions')

    expect(text).toContain('Ship a verified artifact')
    expect(text).toContain('planned · rev 2 · session-bound')
    expect(text).toContain('○ produce → ○ evaluate → ○ verify')
    expect(text).toContain('evidence 0/0 verified · budget $0.00 settled, $0.00 reserved of $10.00 (estimate $1.00)')
    expect(text).not.toMatch(/[\u001b\u202e]/)
  })

  test('missions: no observation file reads n/a with how to start one', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const missions = await drawn($, 'missions')

    expect(missions.text).toContain('No mission yet (ADR-406)')
    expect(elementsOf(missions.tree, 'Input').map(keyOf)).toEqual(['start-field-mission'])
  })

  test('x.ruv.io: the federation menu with its commands, and no registry or roster asked with the network off', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'xruv')

    expect(rasters).toEqual(['header', 'title'])
    expect(text).toContain(' JOIN ....')
    expect(text).toContain('WORK CLAIMS')
    expect(text).toContain('Turn on federationNetwork in /config')
    expect(world.runs.some(argv => /x_federation_(registry|roster)/.test(argv.join(' ')))).toBe(false)
  })

  test('terminal: the harness picker, what the pick runs, and the text field; nothing runs unasked', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    mock.clock(on)
    await $.session.start(SESSION)

    const { text, tree } = await drawn($, 'terminal')

    expect(text).toContain('[c: CODEX]')
    expect(text).toContain('codex exec, read-only sandbox, one thread per project')
    expect(text).toContain('codex: new session')
    expect(elementsOf(tree, 'Input').map(keyOf)).toEqual(['term-input'])
    expect(world.runs.some(argv => argv[0] === 'codex' || argv[0] === 'claude')).toBe(false)
  })

  test('skills: installed, search and create sections; opening lists, nothing else runs until asked and confirmed', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const skillRuns = () => world.runs.filter(argv => argv[2] === 'skills').map(argv => argv.slice(3).join(' '))

    world.respond = argv => (argv[2] !== 'skills' ? cliAnswer(argv) : argv[3] === 'ls' ? { exitCode: 0, stdout: argv.includes('-g') ? LS_GLOBAL : '[]', stderr: '' } : argv[3] === 'find' ? { exitCode: 0, stdout: FIND_OUT, stderr: '' } : { exitCode: 0, stdout: 'done\n', stderr: '' })
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, tree } = await drawn($, 'skills')

    expect(text).toContain('INSTALLED')
    expect(text).toContain('SEARCH')
    expect(text).toContain('CREATE')
    expect(text).toContain('0 project · 2 global')
    expect(text).toMatch(/ faceless-explainer \.+/)
    expect(text).toContain('Claude Code, Codex')
    expect(elementsOf(tree, 'Input').map(keyOf)).toEqual(['skills-search', 'skills-create'])
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['sk-update-0', 'sk-remove-0', 'sk-edit-0']))
    // The tab has no hotkey, and the current one reads without a key.
    expect(text).toContain('[🧰 SKILLS]')
    expect(skillRuns()).toEqual(['ls --json', 'ls -g --json'])

    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })

    await pane.input({ key: 'skills-search', text: 'react', kind: 'submit' })

    const found = textOf(await pane.drawn())

    expect(found).toMatch(/ mattpocock\/skills@tdd \.*/)
    expect(found).toContain('1M installs')
    expect(skillRuns()).toEqual(['ls --json', 'ls -g --json', 'find react'])

    await pane.press({ key: 'sk-addg-0' })
    expect(textOf(await pane.drawn())).toContain('runs: npx -y skills add mattpocock/skills@tdd -g -y')
    expect(skillRuns().some(line => line.startsWith('add'))).toBe(false)

    await pane.press({ key: 'confirm' })
    await pane.drawn()
    expect(skillRuns()).toContain('add mattpocock/skills@tdd -g -y')
    await pane.unmount()
  })

  test('empty sections offer the button that starts them, not a command to copy; a start asks first and runs one fixed argv', { options: { boot: false } }, async ($, on) => {
    const { ".claude-flow/hive-mind/state.json": _hive, ...withoutHive } = RUFLO_FILES
    const world = worldOf(on, withoutHive)

    mock.clock(on)
    await $.session.start(SESSION)

    // A project with no hive-mind: the view says so and offers to start one.
    await $.command.run(command('hive'))

    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })
    const hive = await pane.drawn()

    expect(textOf(hive)).toContain('No hive-mind here yet')
    expect(textOf(hive)).not.toContain('npx ruflo')
    expect(elementsOf(hive, 'Button').map(keyOf)).toContain('start-hive')

    await pane.press({ key: 'start-hive' })
    expect(textOf(await pane.drawn())).toContain('Confirm: start a hive-mind: a queen with raft consensus?')
    expect(world.runs.some(argv => argv.includes('hive-mind') && argv.includes('init'))).toBe(false)

    await pane.press({ key: 'confirm' })

    const ran = world.runs.filter(argv => argv.includes('hive-mind') && argv.includes('init'))

    expect(ran.map(argv => argv.slice(4))).toEqual([['hive-mind', 'init', '--consensus', 'raft']])
    await pane.unmount()
  })

  test('starts that take a sentence refuse a leading dash and an empty one; nothing runs', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    mock.clock(on)
    await $.session.start(SESSION)

    for (const text of ['', '--force']) {
      expect((await $.command.run(command(`run start-task ${text}`))).text ?? '').not.toMatch(/^Asked: /)
    }

    expect(world.runs.some(argv => argv.includes('task') && argv.includes('create'))).toBe(false)
  })

  test('main menu: bare /ruflo lands on it in the BBS look; its prompt takes a key or a name', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command())

    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })
    const menu = await pane.drawn()

    expect(elementsOf(menu, 'Raster').map(keyOf)).toEqual(['header', 'title'])
    expect(textOf(menu)).toContain('▓▒░ SWARM ░▒▓')
    expect(textOf(menu)).toContain('── live')
    expect(textOf(menu)).toContain('Swarm Topology')
    expect(textOf(menu)).toContain('ANSI-BBS')
    expect(elementsOf(menu, 'Input').map(keyOf)).toEqual(['menu-prompt'])

    await pane.input({ key: 'menu-prompt', text: 'w', kind: 'submit' })
    expect(textOf(await pane.drawn())).toContain('MAIN MENU')

    await pane.press({ key: 'tab-menu' })
    await pane.input({ key: 'menu-prompt', text: 'nope', kind: 'submit' })
    expect(textOf(await pane.drawn())).toContain('no area "nope"')
    await pane.unmount()
  })
})
