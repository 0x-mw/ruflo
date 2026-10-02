import type { RenderElement } from 'claude-code'

import type { Channels, Registry, Roster } from '../data/cli'
import { ago, clip, col, isBbs, kv, live, row, rule, sourceLine, text, THEME, type Ctx } from './common'

/** What the open federation offers, as `ruflo federation <sub>` names it; `admin` ones need the gateway's token. */
const MENU: readonly { letter: string; name: string; about: string; command?: string; isAdmin?: boolean }[] = [
  { letter: 'J', name: 'JOIN', about: 'your own key, NIP-98 signed, no invite on open relays', command: 'federation join' },
  { letter: 'R', name: 'ROSTER', about: 'who is online now, one row per pubkey', command: 'federation roster' },
  { letter: 'S', name: 'SYNC', about: 'the last hour of signed swarm messages', command: 'federation sync --limit 20' },
  { letter: 'W', name: 'WORK CLAIMS', about: 'one owner per resource, TTLs and handoffs applied', command: 'federation claims' },
  { letter: 'C', name: 'CHANNELS', about: 'pub: plaintext rooms, prv: encrypted to members', command: 'federation channel --action list' },
  { letter: 'G', name: 'REGISTRY', about: 'relay, NIP-42 tag, gateway key, join steps', command: 'federation registry' },
  { letter: 'I', name: 'INVITES', about: 'use-limited codes for a new member', isAdmin: true },
  { letter: 'A', name: 'ADMIT', about: 'NIP-43 membership for a pubkey', isAdmin: true },
  { letter: 'P', name: 'PUBLISH', about: 'a hub broadcast as the gateway', isAdmin: true },
]

/**
 * The x.ruv.io board: a Wildcat-style main menu of what the open federation offers (each entry opens the terminal
 * with its ruflo command typed, run only after Enter twice), then the registry's own word on how to join and which
 * rooms to sit in, this node's channels, and who is on. The registry and the roster are on the network, so without
 * `federationNetwork` they say how to turn it on and nothing is asked.
 */
export function xruvView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const isNet = state.options.federationNetwork
  const registry = live<Registry>(state.probes.get('registry'))
  const channels = live<Channels>(state.probes.get('channels'))
  const roster = live<Roster>(state.probes.get('roster'))
  const rows: RenderElement[] = [rule(ctx, 'Main menu', 'ruflo federation · x_federation_* tools')]
  const lead = Math.max(14, Math.min(18, ctx.columns - 40))

  for (const item of MENU) {
    const name = ` ${item.name} `.padEnd(lead, '.')
    const parts: RenderElement[] = [
      ctx.kit.Text({ bold: true, color: THEME.ok, children: ` [${item.letter}]` }),
      ctx.kit.Text({ bold: true, color: item.isAdmin === true ? THEME.warn : THEME.head, children: name }),
      ctx.kit.Text({ color: THEME.info, wrap: 'truncate-end', children: clip(` ${item.about}${item.isAdmin === true ? ' (admin)' : ''}`, Math.max(4, ctx.columns - lead - 22)) }),
    ]

    if (item.command !== undefined) {
      const command = item.command

      parts.push(ctx.kit.Button({ key: `xr-${item.letter}`, label: ' ▸ open', plain: true, dimColor: true, onPress: () => ctx.act.term.load('ruflo', command) }))
    }

    rows.push(row(ctx, parts, `xr-row-${item.letter}`))
  }

  rows.push(text(ctx, ' ▸ open puts the command in the terminal (i): Enter shows it, Enter again runs it', { dimColor: true }))
  rows.push(rule(ctx, 'How to join', isNet ? 'from the registry · gateway text' : 'network off'))

  if (!isNet) {
    rows.push(text(ctx, ' The registry is on x.ruv.io. Turn on federationNetwork in /config (ruflo-console) to ask it.', { dimColor: true }))
    rows.push(text(ctx, ' Or run `npx ruflo federation join`: it makes ~/.ruflo/nostr.key and registers with it.', { dimColor: true }))
  } else if (registry === null) {
    rows.push(text(ctx, ` ${sourceLine(state.probes.get('registry'), nowMs, 'registry').text}`, { dimColor: true }))
  } else {
    rows.push(kv(ctx, 'relay', `${registry.relay ?? 'n/a'}${registry.swarmTag !== undefined ? ` · tag #${registry.swarmTag}` : ''}`))
    rows.push(kv(ctx, 'gateway key', registry.gatewayPubkey !== undefined ? `${registry.gatewayPubkey.slice(0, 16)}…` : 'n/a'))
    if (registry.registration !== undefined) {
      const reg = registry.registration

      rows.push(kv(ctx, 'registration', `${reg.isOpen ? 'open' : 'closed'}${reg.auth !== undefined ? ` · ${reg.auth}` : ''}${reg.limits !== undefined ? ` · ${reg.limits}` : ''}`, reg.isOpen ? THEME.ok : THEME.warn))
    }
    for (const step of registry.join.slice(0, 4)) rows.push(text(ctx, ` ${clip(step, 160)}`, { color: THEME.info }))
  }

  rows.push(rule(ctx, 'Rooms', isNet && registry !== null ? 'default channels' : 'joined here'))

  const defaults = registry?.channels ?? []

  if (defaults.length > 0) {
    for (const room of defaults.slice(0, 5)) {
      rows.push(
        row(ctx, [
          ctx.kit.Text({ bold: true, color: THEME.head, children: ` #${room.name.padEnd(14)} ` }),
          ctx.kit.Text({ dimColor: !isBbs(), color: THEME.info, wrap: 'truncate-end', children: clip(room.purpose ?? '', Math.max(4, ctx.columns - 18)) }),
        ]),
      )
    }
  } else if (channels !== null && channels.channels.length > 0) {
    for (const channel of channels.channels.slice(0, 5)) rows.push(text(ctx, ` # ${channel.name ?? channel.id} · ${channel.id.startsWith('prv:') ? 'private' : 'public'} · since ${ago(channel.atMs, nowMs)}`))
  } else {
    rows.push(text(ctx, ` ${channels === null ? sourceLine(state.probes.get('channels'), nowMs, 'channels').text : 'no channels joined here yet'}`, { dimColor: true }))
  }

  rows.push(rule(ctx, 'Who is on', isNet ? 'roster · unvetted' : 'network off'))

  if (!isNet) {
    rows.push(text(ctx, ' Off: the roster is on the public relay (federationNetwork).', { dimColor: true }))
  } else if (roster === null) {
    rows.push(text(ctx, ` ${sourceLine(state.probes.get('roster'), nowMs, 'roster').text}`, { dimColor: true }))
  } else if (roster.members.length === 0) {
    rows.push(text(ctx, ` nobody announcing on ${roster.relay ?? 'the relay'} (${ago(roster.atMs, nowMs)})`, { dimColor: true }))
  } else {
    for (const member of roster.members.slice(0, 5)) rows.push(text(ctx, ` ◉ ${member.name}${member.detail !== undefined ? ` — ${member.detail}` : ''}`))
    rows.push(text(ctx, ` ${roster.members.length} on · third-party text, not vetted · ${ago(roster.atMs, nowMs)}`, { dimColor: true }))
  }

  return col(ctx, rows, 'xruv')
}
