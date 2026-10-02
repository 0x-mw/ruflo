/**
 * The Hive-Mind's pure parts: the hive file read with every field the CLI writes (and never its token), the CLI's quorum
 * arithmetic, the actions' argv, the vote events, and the honeycomb's layout, size and stillness. Pure: run with
 * `npx vitest run plugins/ruflo-console/tests/hive.spec.ts`.
 */
import { describe, expect, it } from 'vitest'

import { diffEvents } from '../hooks/data/events'
import { faultTolerance, membersOf, nextVoter, pickedProposal, proposalStrategyOf, proposeBlock, requiredVotes, tallyOf } from '../hooks/data/hive'
import { parseAgents, parseHive, parseHiveAgents, type HiveInfo } from '../hooks/data/parse'
import type { Snapshot } from '../hooks/data/snapshot'
import { cellOrigin, cellsIn, hivePicture, hiveRows, ringsFor, spiral, type HivePictureModel } from '../hooks/gfx/hive'
import { hiveBroadcast, hivePropose, hiveSpawn, hiveVote, proposalText } from '../hooks/hive'
import { BFT_ID, HIVE_AGENTS, HIVE_STATE, RAFT_ID, WORKERS } from './fixtures/hive'
import { HIVE_TOKEN } from './fixtures/ruflo-run'

const hive = parseHive(JSON.stringify(HIVE_STATE)) as HiveInfo
const NOW = Date.parse('2026-10-02T01:10:10.000Z')
const withHive = (next: HiveInfo | null) => ({ hive: next, agents: [], claims: [], tasks: [], swarm: null, neural: null, outcomes: null, federationNodes: null, missions: null, hasNostrKey: null }) as unknown as Snapshot
const cellModel = (members: number, pulseAtMs?: number): HivePictureModel => ({
  queen: { id: 'q', glyph: '♛', tag: 'T1', color: 0xd700d7 },
  members: Array.from({ length: members }, (_, i) => ({ id: `w${i}`, glyph: '●', tag: `w${i}`, color: 0x00afd7, ...(i === 0 && pulseAtMs !== undefined && { pulseAtMs }) })),
  meters: [{ label: 'design', votesFor: 1, votesAgainst: 0, required: 2, nodes: 3, note: 'raft T2', isPicked: true }],
})

describe('the hive file', () => {
  it('reads the queen, term, strategy, ballots, raft and bft fields, history, broadcasts and memory keys', () => {
    expect(hive).toMatchObject({ topology: 'hierarchical', strategy: 'raft', queen: 'queen-1790903321632', queenTerm: 2, workers: [...WORKERS] })
    expect(hive.pending[0]).toMatchObject({ id: RAFT_ID, type: 'design', strategy: 'raft', term: 2, value: 'use raft for the console', proposedBy: 'console-operator', votesFor: 1, votesAgainst: 0, ballots: [{ voter: WORKERS[0], isFor: true }] })
    expect(hive.pending[0]?.timeoutAtMs).toBe(Date.parse('2026-10-02T01:10:30.000Z'))
    expect(hive.pending[1]).toMatchObject({ id: BFT_ID, strategy: 'bft', value: '{"target":"staging"}', byzantine: [WORKERS[2]], votesAgainst: 1 })
    expect(hive.history.map(entry => [entry.type, entry.result, entry.strategy, entry.byzantine])).toEqual([['naming', 'approved', 'raft', 0], ['budget', 'rejected', 'bft', 1]])
    expect(hive.broadcasts.map(entry => [entry.priority, entry.from, entry.message])).toEqual([['normal', 'console-operator', 'standup in 5'], ['high', 'system', 'freeze the main branch']])
    expect(hive.memoryKeys).toEqual(['broadcasts', 'design-notes'])
    expect(JSON.stringify(hive)).not.toContain(HIVE_TOKEN)
  })

  it('keeps each spawned worker\'s hive role, and says which hive workers no store knows', () => {
    const spawned = parseHiveAgents(JSON.stringify(HIVE_AGENTS))
    const members = membersOf(hive, spawned, parseAgents(null))

    expect(spawned.map(agent => agent.role)).toEqual(['worker', 'specialist'])
    expect(members.map(member => [member.role, member.liveness, member.isKnown])).toEqual([['worker', 'busy', true], ['specialist', 'idle', true], ['n/a', 'unknown', false]])
  })
})

describe('quorum, as the CLI counts it', () => {
  it('requires the votes calculateRequiredVotes does', () => {
    expect(requiredVotes('bft', 4)).toBe(3)
    expect(requiredVotes('raft', 4)).toBe(3)
    expect(requiredVotes('raft', 3)).toBe(2)
    expect(requiredVotes('quorum', 4, 'unanimous')).toBe(4)
    expect(requiredVotes('quorum', 6, 'supermajority')).toBe(5)
    expect(requiredVotes('raft', 0)).toBe(1)
  })

  it('states fault tolerance only where the strategy has a bound', () => {
    expect(faultTolerance('byzantine', 4)).toEqual({ faulty: 1, of: 4, rule: 'byzantine f < n/3' })
    expect(faultTolerance('raft', 5)).toEqual({ faulty: 2, of: 5, rule: 'raft f < n/2' })
    expect(faultTolerance('gossip', 5)).toBeNull()
    expect(faultTolerance('raft', 0)).toBeNull()
    expect([proposalStrategyOf('byzantine'), proposalStrategyOf('quorum'), proposalStrategyOf('crdt')]).toEqual(['bft', 'quorum', null])
  })

  it('tallies a proposal against its bar, and sees a raft timeout', () => {
    const tally = tallyOf(hive, hive.pending[0] as HiveInfo['pending'][number], NOW)

    expect([tally.required, tally.nodes, tally.isTimedOut, tally.isDeadlocked]).toEqual([2, 3, false, false])
    expect(tallyOf(hive, hive.pending[0] as HiveInfo['pending'][number], NOW + 60_000).isTimedOut).toBe(true)
    expect(pickedProposal(hive, -1)?.id).toBe(BFT_ID)
  })
})

describe('hive actions', () => {
  it('votes as the next worker without a ballot, through the subcommand that carries the token', () => {
    const proposal = hive.pending[0] as HiveInfo['pending'][number]

    expect(nextVoter(hive, proposal)).toBe(WORKERS[1])
    expect(hiveVote(hive, proposal, false)?.args).toEqual(['hive-mind', 'consensus', '--action', 'vote', '--proposal-id', RAFT_ID, '--vote', 'no', '--voter-id', WORKERS[1]])
    expect(hiveVote({ ...hive, workers: [] }, proposal, true)).toBeNull()
  })

  it('refuses a second raft proposal in the same term before asking', () => {
    expect(proposeBlock(hive)).toMatch(/^raft term 2 already has design/)
    expect(hivePropose(hive, 'design: anything')).toBeNull()

    const open = { ...hive, pending: hive.pending.filter(entry => entry.strategy !== 'raft') }

    expect(hivePropose(open, 'review: ship it')?.args).toEqual(['mcp', 'exec', '-t', 'hive-mind_consensus', '-p', JSON.stringify({ action: 'propose', type: 'review', value: 'ship it', voterId: 'console-operator', strategy: 'raft' })])
    expect(proposalText('no prefix here')).toEqual({ type: 'general', value: 'no prefix here' })
    expect(hivePropose(open, '--flag')).toBeNull()
  })

  it('broadcasts and spawns with fixed argv, and only roles the CLI accepts', () => {
    expect(hiveBroadcast('hello hive')?.args).toEqual(['mcp', 'exec', '-t', 'hive-mind_broadcast', '-p', JSON.stringify({ message: 'hello hive', priority: 'normal', fromId: 'console-operator' })])
    expect(hiveSpawn(hive, 'scout')?.args).toEqual(['mcp', 'exec', '-t', 'hive-mind_spawn', '-p', JSON.stringify({ role: 'scout', agentType: 'worker', prefix: 'hive-worker' })])
    expect(hiveSpawn(hive, 'queen')).toBeNull()
  })
})

describe('hive events', () => {
  it('emits one event per new ballot and per join, tagged with that worker', () => {
    const before = { ...hive, workers: WORKERS.slice(0, 2), pending: hive.pending.map(entry => ({ ...entry, ballots: [], votesFor: 0, votesAgainst: 0 })) }
    const events = diffEvents(withHive(before), withHive(hive), 5)

    expect(events.map(event => [event.agentId, event.text])).toEqual(
      expect.arrayContaining([
        [WORKERS[0], `${WORKERS[0]} voted for design (${RAFT_ID})`],
        [WORKERS[1], `${WORKERS[1]} voted against deploy (${BFT_ID})`],
        [WORKERS[2], `${WORKERS[2]} joined the hive`],
      ]),
    )
  })
})

describe('the honeycomb', () => {
  it('walks the rings centre first, and no two cells share an interior', () => {
    const rings = 3
    const slots = spiral(rings)
    const interiors = new Set<string>()

    expect(slots).toHaveLength(cellsIn(rings))
    expect(slots[0]).toEqual([0, 0])

    for (const [q, r] of slots) {
      const { x, y } = cellOrigin(q, r, rings, 100)

      for (let dx = 1; dx <= 4; dx++) {
        const key = `${x + dx},${y + 1}`

        expect(interiors.has(key)).toBe(false)
        interiors.add(key)
      }

      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
    }
  })

  it('puts the queen in the centre and grows rings only as wide as the columns allow', () => {
    const grid = hivePicture(cellModel(6), 80, 0)
    const { x, y } = cellOrigin(0, 0, ringsFor(6, 80), 80)

    expect(String.fromCodePoint(grid.glyph(x + 1, y + 1))).toBe('♛')
    expect([ringsFor(0, 80), ringsFor(6, 80), ringsFor(7, 80), ringsFor(60, 80), ringsFor(60, 30)]).toEqual([0, 1, 2, 4, 2])
    expect(grid.rows).toBe(hiveRows(cellModel(6), 80))
  })

  it('is still with no fresh event, and blinks for two seconds after one, at one size', () => {
    const still = cellModel(8)

    expect(hivePicture(still, 90, 1_000).encode()).toBe(hivePicture(still, 90, 987_654).encode())

    const pulsed = cellModel(8, 10_000)
    const sizes = new Set([0, 10_100, 10_300, 11_900, 12_100].map(t => `${hivePicture(pulsed, 90, t).columns}x${hivePicture(pulsed, 90, t).rows}`))

    expect(sizes.size).toBe(1)
    expect(hivePicture(pulsed, 90, 10_100).encode()).not.toBe(hivePicture(still, 90, 10_100).encode())
    expect(hivePicture(pulsed, 90, 12_100).encode()).toBe(hivePicture(still, 90, 12_100).encode())
  })
})
