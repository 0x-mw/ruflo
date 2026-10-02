/**
 * The Hive-Mind view: what `.claude-flow/hive-mind/state.json` records. The queen and her term, the consensus strategy
 * with the fault tolerance and quorum it implies, every worker with its role and liveness, the open proposals against
 * their bar (pick one with j/k), the decided ones, and the broadcasts. Every action asks y/n first and runs one fixed
 * argv: vote (as the next worker that has not voted), propose, broadcast, spawn.
 */
import type { RenderElement } from 'claude-code'

import { faultTolerance, membersOf, nextVoter, nodesOf, pickedProposal, proposalStrategyOf, proposeBlock, requiredVotes, tallyOf, type Liveness, type Member, type Tally } from '../data/hive'
import { shortId, type HiveInfo } from '../data/parse'
import { HIVE_COLOR, type HiveCell, type HivePictureModel } from '../gfx/hive'
import type { State } from '../state'
import { ago, button, clip, col, kv, picture, row, rule, text, THEME, type Ctx } from './common'

const ROLE_GLYPH: Record<string, string> = { worker: '●', specialist: '◆', scout: '▲' }
const LIVE_COLOR: Record<Liveness, number> = { busy: HIVE_COLOR.yellow, idle: HIVE_COLOR.cyan, error: HIVE_COLOR.pink, down: HIVE_COLOR.grey, unknown: HIVE_COLOR.wall }
const LIVE_THEME = (liveness: Liveness): { color?: string; dimColor?: boolean } =>
  liveness === 'busy' ? { color: THEME.warn } : liveness === 'idle' ? { color: THEME.info } : liveness === 'error' ? { color: THEME.bad } : { dimColor: true }

const glyphOf = (member: Member): string => (member.isKnown ? (ROLE_GLYPH[member.role] ?? '●') : '○')

/** The bar a proposal must clear, as the CLI's rule reads in words. */
function ruleOf(strategy: string, preset?: string): string {
  if (strategy === 'bft') return '2/3 + 1'
  if (strategy === 'quorum') return preset ?? 'majority'

  return 'majority'
}

/** The honeycomb's model for this frame: the queen, each worker's cell with its ballot on the picked proposal, the meters. */
export function hivePictureModelOf(state: State, nowMs: number, pulses: Map<string, number>): HivePictureModel | null {
  const snap = state.snapshot
  const hive = snap?.hive ?? null

  if (snap === null || hive === null) return null

  const picked = pickedProposal(hive, state.select.item)
  const queenPulse = hive.queen === undefined ? undefined : pulses.get(hive.queen)
  const members = membersOf(hive, snap.hiveAgents, snap.agents).map((member): HiveCell => {
    const ballot = picked?.ballots.find(entry => entry.voter === member.id)
    const vote = picked?.byzantine.includes(member.id) === true ? 'byzantine' : ballot === undefined ? undefined : ballot.isFor ? 'for' : 'against'
    const pulseAtMs = pulses.get(member.id)

    return { id: member.id, glyph: glyphOf(member), tag: shortId(member.id).slice(-3), color: LIVE_COLOR[member.liveness], ...(vote !== undefined && { vote }), ...(pulseAtMs !== undefined && { pulseAtMs }) }
  })

  return {
    queen: { id: hive.queen ?? 'queen', glyph: hive.queen === undefined ? '?' : '♛', tag: hive.queenTerm === undefined ? '' : `T${hive.queenTerm}`, color: hive.queen === undefined ? HIVE_COLOR.grey : HIVE_COLOR.magenta, ...(queenPulse !== undefined && { pulseAtMs: queenPulse }) },
    members,
    meters: hive.pending.map(proposal => {
      const tally = tallyOf(hive, proposal, nowMs)

      return { label: proposal.type, votesFor: proposal.votesFor, votesAgainst: proposal.votesAgainst, required: tally.required, nodes: tally.nodes, note: noteOf(tally), isPicked: proposal.id === picked?.id }
    }),
  }
}

/** A proposal's strategy, term and state of play in a few words. */
function noteOf(tally: Tally): string {
  const { proposal } = tally

  return [`${proposal.strategy}${proposal.term !== undefined ? ` T${proposal.term}` : ''}${proposal.quorumPreset !== undefined ? ` ${proposal.quorumPreset}` : ''}`, tally.isTimedOut ? 'timed out' : '', tally.isDeadlocked ? 'deadlocked' : '']
    .filter(Boolean)
    .join(' · ')
}

/** A ten-cell text bar of a proposal's votes over the hive's nodes, for the text form of the view. */
function bar(tally: Tally): string {
  const of = (votes: number) => Math.round((Math.min(votes, tally.nodes) / tally.nodes) * 10)
  const yes = of(tally.proposal.votesFor)
  const no = Math.min(10 - yes, of(tally.proposal.votesAgainst))

  return `${'█'.repeat(yes)}${'▓'.repeat(no)}${'░'.repeat(10 - yes - no)}`
}

function summary(ctx: Ctx, hive: HiveInfo, members: Member[]): RenderElement[] {
  const workers = hive.workers.length
  const strategy = proposalStrategyOf(hive.strategy)
  const tolerance = faultTolerance(hive.strategy, workers)
  const required = requiredVotes(strategy ?? 'raft', nodesOf(hive))
  const isRaft = strategy === 'raft'
  const counts = (liveness: Liveness) => members.filter(member => member.liveness === liveness).length
  const keys = hive.memoryKeys.filter(key => key !== 'broadcasts').length

  return [
    kv(
      ctx,
      isRaft ? 'queen (leader)' : 'queen',
      hive.queen === undefined ? 'n/a — no queen recorded' : `${hive.queen}${hive.queenTerm !== undefined ? ` · term ${hive.queenTerm}` : ''} · elected ${ago(hive.queenElectedAtMs, ctx.nowMs)}`,
      THEME.head,
    ),
    kv(ctx, 'consensus', `${hive.strategy ?? 'n/a'} · proposals vote ${strategy ?? `raft (the tool's default: ${hive.strategy ?? 'this strategy'} has no vote rule of its own)`}`),
    kv(ctx, 'fault tolerance', tolerance === null ? `n/a — ${workers === 0 ? 'no workers' : `no bound stated for ${hive.strategy ?? 'this strategy'}`}` : `tolerates ${tolerance.faulty} faulty of ${tolerance.of} (${tolerance.rule})`),
    kv(ctx, 'quorum', `${required} of ${nodesOf(hive)} votes to pass (${ruleOf(strategy ?? 'raft')})${workers === 0 ? ' · the CLI counts an empty hive as one node' : ''}`),
    kv(ctx, 'workers', workers === 0 ? 'none yet — spawn one below' : `${workers} · ${counts('busy')} busy · ${counts('idle')} idle · ${counts('down') + counts('error')} down · ${members.filter(member => !member.isKnown).length} in no agent store`),
    kv(ctx, 'shared memory', `${keys} key${keys === 1 ? '' : 's'} · ${hive.broadcasts.length} broadcast${hive.broadcasts.length === 1 ? '' : 's'} · updated ${ago(hive.updatedAtMs, ctx.nowMs)}`),
  ]
}

function workersSection(ctx: Ctx, hive: HiveInfo, members: Member[]): RenderElement[] {
  const picked = pickedProposal(hive, ctx.state.select.item)
  const rows: RenderElement[] = [rule(ctx, 'Workers', `${members.length} · role · liveness · ballot on the picked proposal`)]

  if (members.length === 0) rows.push(text(ctx, 'No workers have joined. A vote needs a registered worker: spawn one below.', { dimColor: true }))

  for (const member of members.slice(0, 12)) {
    const ballot = picked?.ballots.find(entry => entry.voter === member.id)
    const vote = picked === null ? '' : picked.byzantine.includes(member.id) ? 'byzantine' : ballot === undefined ? 'not voted' : ballot.isFor ? 'for' : 'against'

    rows.push(
      row(ctx, [
        ctx.kit.Text({ ...LIVE_THEME(member.liveness), children: ` ${glyphOf(member)} ` }),
        ctx.kit.Text({ wrap: 'truncate-end', children: clip(`${shortId(member.id).padEnd(7)} ${member.role.padEnd(11)} ${member.status.padEnd(15)} ${vote.padEnd(10)} ${member.id}`, ctx.columns - 4) }),
      ]),
    )
  }

  if (members.length > 12) rows.push(text(ctx, `+${members.length - 12} more workers`, { dimColor: true }))

  return rows
}

function proposalsSection(ctx: Ctx, hive: HiveInfo): RenderElement[] {
  const picked = pickedProposal(hive, ctx.state.select.item)
  const rows: RenderElement[] = [rule(ctx, 'Proposals', hive.pending.length === 0 ? 'none open' : `${hive.pending.length} open · j/k pick`)]

  if (hive.pending.length === 0) rows.push(text(ctx, 'No open proposals. Propose one below.', { dimColor: true }))

  for (const proposal of hive.pending.slice(0, 8)) {
    const tally = tallyOf(hive, proposal, ctx.nowMs)
    const isPicked = proposal.id === picked?.id
    const deadline = proposal.timeoutAtMs === undefined ? '' : tally.isTimedOut ? ' · timed out: re-propose in the next term' : ` · times out in ${Math.ceil((proposal.timeoutAtMs - ctx.nowMs) / 1000)}s`

    rows.push(
      text(ctx, `${isPicked ? '▸' : ' '}◇ ${proposal.type} (${noteOf(tally)}) ${proposal.status} · for ${proposal.votesFor} · against ${proposal.votesAgainst} · [${bar(tally)}] need ${tally.required} of ${tally.nodes}`, isPicked ? { bold: true, color: THEME.warn } : { color: THEME.warn }),
    )

    if (!isPicked) continue

    const voters = (isFor: boolean) => proposal.ballots.filter(ballot => ballot.isFor === isFor).map(ballot => shortId(ballot.voter)).join(', ') || '—'

    rows.push(text(ctx, `    "${proposal.value ?? 'n/a'}" · by ${proposal.proposedBy ?? 'n/a'} · ${ago(proposal.proposedAtMs, ctx.nowMs)}${deadline}`, { dimColor: true }))
    rows.push(text(ctx, `    for: ${voters(true)} · against: ${voters(false)}${proposal.byzantine.length > 0 ? ` · byzantine (excluded): ${proposal.byzantine.map(shortId).join(', ')}` : ''} · ${proposal.id}`, { dimColor: true }))
  }

  if (picked !== null && ctx.columns >= 44) {
    const voter = nextVoter(hive, picked)

    rows.push(
      row(ctx, [
        ...(hive.pending.length > 1 ? [button(ctx, 'item-prev', 'prev', () => ctx.act.select(-1), { hotkey: 'k' }), button(ctx, 'item-next', 'next', () => ctx.act.select(1), { hotkey: 'j' })] : []),
        ...(voter === null ? [] : [button(ctx, 'hive-vote-yes', 'Vote for', () => void ctx.act.run('hive-vote-yes'), { hotkey: 'f' }), button(ctx, 'hive-vote-no', 'Vote against', () => void ctx.act.run('hive-vote-no'), { hotkey: 'a' })]),
      ]),
    )
    rows.push(text(ctx, voter === null ? `vote: n/a — ${hive.workers.length === 0 ? 'no registered worker to vote as (the CLI counts only workers): spawn one' : 'every worker has voted on it'}` : `a vote is cast as the next worker that has not voted: ${voter}`, { dimColor: true }))
  }

  return rows
}

function historySection(ctx: Ctx, hive: HiveInfo): RenderElement[] {
  const rows: RenderElement[] = [rule(ctx, 'Decided', `${hive.history.length} on record`)]

  if (hive.history.length === 0) rows.push(text(ctx, 'Nothing decided yet.', { dimColor: true }))

  for (const decision of hive.history.slice(-6).reverse()) {
    const isApproved = decision.result === 'approved'

    rows.push(
      text(
        ctx,
        `${isApproved ? '◆' : '◇'} ${decision.type} → ${decision.result} · for ${decision.votesFor} · against ${decision.votesAgainst}${decision.strategy !== undefined ? ` · ${decision.strategy}${decision.term !== undefined ? ` T${decision.term}` : ''}` : ''}${decision.byzantine > 0 ? ` · ${decision.byzantine} byzantine` : ''} · ${ago(decision.decidedAtMs, ctx.nowMs)}`,
        { color: isApproved ? THEME.ok : THEME.bad },
      ),
    )
  }

  return rows
}

function broadcastSection(ctx: Ctx, hive: HiveInfo): RenderElement[] {
  const rows: RenderElement[] = [rule(ctx, 'Broadcasts', `${hive.broadcasts.length} kept · shared memory`)]

  if (hive.broadcasts.length === 0) rows.push(text(ctx, 'No broadcasts yet.', { dimColor: true }))

  for (const message of hive.broadcasts.slice(-5).reverse()) {
    rows.push(text(ctx, `${ago(message.atMs, ctx.nowMs).padStart(8)} [${message.priority}] ${message.from}: ${message.message}`, message.priority === 'high' || message.priority === 'critical' ? { color: THEME.warn } : {}))
  }

  const keys = hive.memoryKeys.filter(key => key !== 'broadcasts')

  if (keys.length > 0) rows.push(text(ctx, `memory keys: ${keys.slice(0, 12).join(', ')}${keys.length > 12 ? ` +${keys.length - 12}` : ''}`, { dimColor: true }))

  return rows
}

function actSection(ctx: Ctx, hive: HiveInfo): RenderElement[] {
  const block = proposeBlock(hive)
  const rows: RenderElement[] = [rule(ctx, 'Act', 'each asks y/n, then runs one ruflo command')]
  const Input = ctx.kit.Input

  if (Input === undefined) {
    rows.push(text(ctx, 'propose and broadcast from the palette: p → "propose design: use raft", "broadcast hello"', { dimColor: true }))
  } else {
    rows.push(Input({ key: 'hive-propose', label: 'propose', placeholder: block ?? 'type: the decision (design: use raft for the console)', submitLabel: 'ask', onSubmit: value => void ctx.act.run('propose', value) }))
    rows.push(Input({ key: 'hive-broadcast', label: 'broadcast', placeholder: 'a message for every worker', submitLabel: 'ask', onSubmit: value => void ctx.act.run('broadcast', value) }))
  }

  if (block !== null) rows.push(text(ctx, `propose: n/a — ${block}`, { color: THEME.warn }))

  if (ctx.columns >= 44) {
    rows.push(row(ctx, [button(ctx, 'hive-spawn-worker', 'Spawn worker', () => void ctx.act.run('hive-spawn-worker'), { hotkey: 's' }), button(ctx, 'hive-spawn-specialist', 'specialist', () => void ctx.act.run('hive-spawn-specialist')), button(ctx, 'hive-spawn-scout', 'scout', () => void ctx.act.run('hive-spawn-scout'))]))
  }

  return rows
}

export function hiveView(ctx: Ctx): RenderElement {
  const snap = ctx.state.snapshot
  const hive = snap?.hive ?? null

  if (snap === null) return text(ctx, 'reading ruflo state…', { dimColor: true })

  if (hive === null) {
    return col(ctx, [rule(ctx, 'Hive-Mind', 'not initialised'), text(ctx, 'No hive-mind here. `npx ruflo hive-mind init --consensus raft` starts one with a queen; spawn workers to vote.', { dimColor: true })], 'hive')
  }

  const members = membersOf(hive, snap.hiveAgents, snap.agents)

  return col(
    ctx,
    [
      rule(ctx, 'Hive-Mind', `${hive.topology} · ${hive.strategy ?? 'consensus n/a'}`),
      ...summary(ctx, hive, members),
      picture(ctx, 'hive', `honeycomb needs a terminal: the queen and ${members.length} workers`),
      text(ctx, '♛ queen · ● worker ◆ specialist ▲ scout ○ in no store · yellow busy, cyan idle, grey down · walls: green for, pink against, yellow byzantine · a cell flashes 2 s when its vote lands', { dimColor: true }),
      ...proposalsSection(ctx, hive),
      ...workersSection(ctx, hive, members),
      ...historySection(ctx, hive),
      ...broadcastSection(ctx, hive),
      ...actSection(ctx, hive),
    ],
    'hive',
  )
}
