import type { Hook, Register } from 'claude-code'

import { answer } from './command'
import { verdict } from './guard'
import { readOptions, type ModOptions } from './options'
import { cacheKey, frame, parse, screen, worthRecalling } from './recall'
import { newStats, noteAttached, STATUS_PATH, statusText, type Stats } from './status'
import { pickReader, type Reader } from './tools'

const CACHE_MS = 600_000
const CACHE_MAX = 50
const TEXT_CAP = 60_000

type Dollar = Parameters<Hook<'session.start'>>[0]

/** Everything one session of the mod keeps: its settings, counters, the recall cache, the project root and the reader found. */
type Session = {
  readonly opts: ModOptions
  readonly stats: Stats
  readonly cache: Map<string, { atMs: number; block: string }>
  root?: string
  reader?: Reader
}

type Read = { readonly tool: string; readonly text: string }

/** The first connected memory reader, found once per session and again after a miss (a server may connect late). */
async function find($: Dollar, s: Session): Promise<Reader | undefined> {
  if (s.reader === undefined) s.reader = pickReader(await $.tool.list(), s.opts.source)
  return s.reader
}

async function flush($: Dollar, s: Session): Promise<void> {
  if (s.root === undefined) return
  try {
    await $.fs.write(`${s.root}/${STATUS_PATH}`, statusText(s.stats, s.opts, await $.clock.now()))
  } catch {
    /* the status file is a courtesy */
  }
}

/** One read through a connected tool, bounded by `ms`: its first text block, 'late' past the deadline, undefined when none is connected. */
async function read($: Dollar, s: Session, query: string, ms: number): Promise<Read | 'late' | undefined> {
  const r = await find($, s)
  if (!r) return undefined
  const call = $.mcp.call(r.server, r.tool, r.args(query.slice(0, 1000), s.opts.recallLimit)).then(res => ({ tool: r.label, text: res.isError ? '' : (res.content.find(b => b.type === 'text')?.text ?? '').slice(0, TEXT_CAP) }))
  const won = await Promise.race([call, $.clock.sleep(ms).then(() => 'late' as const, () => 'late' as const)])
  if (won === 'late') call.catch(() => undefined)
  return won
}

/** The prompt hook's work: returns the block to attach, or undefined (skipped, late, nothing relevant, an error). */
async function recallFor($: Dollar, s: Session, text: string): Promise<string | undefined> {
  const { stats, opts } = s
  if (!worthRecalling(text)) {
    stats.skipped++
    return undefined
  }
  const now = await $.clock.now()
  const key = cacheKey(text)
  const hit = s.cache.get(key)
  if (hit && now - hit.atMs < CACHE_MS) {
    stats.cached++
    return hit.block
  }
  try {
    const got = await read($, s, text, opts.recallDeadlineMs)
    if (got === 'late') {
      stats.timedOut++
      return undefined
    }
    if (!got) {
      stats.skipped++
      return undefined
    }
    stats.lastMs = (await $.clock.now()) - now
    stats.lastTool = got.tool
    const screened = screen(parse(got.text, got.tool, now), opts.recallLimit)
    stats.dropped += screened.unsafe
    if (screened.items.length === 0) {
      if (screened.unsafe > 0) await flush($, s)
      return undefined
    }
    const block = frame(screened.items)
    if (s.cache.size >= CACHE_MAX) s.cache.delete(s.cache.keys().next().value as string)
    s.cache.set(key, { atMs: now, block })
    noteAttached(stats, screened.items, now)
    await flush($, s)
    return block
  } catch {
    stats.errors++
    s.reader = undefined
    return undefined
  }
}

/**
 * AgentDB as a mod (ADR-445): safe recall into the prompt (opt-in, per-prompt context, deadline-bounded, screened as untrusted), a write
 * guard that keeps secrets out of memory, `/agentdb`, and a status file the console reads. No network, no CLI: only tools already connected.
 */
export const register: Register = (on, options) => {
  const s: Session = { opts: readOptions(options), stats: newStats(), cache: new Map() }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    s.root = (await $.session.root()) as string | undefined
    await $.command.register({ name: 'agentdb', description: 'AgentDB memory: status, recall <text>, scan <text>, recent' })
    await flush($, s)
    return result
  })

  if (s.opts.recall && s.opts.source !== 'none') {
    on('prompt.submit', async ($, e, next) => {
      const block = await recallFor($, s, typeof e.text === 'string' ? e.text : '')
      return next(block === undefined ? e : { ...e, context: [...(e.context ?? []), block] })
    })
  }

  if (s.opts.guard) {
    on('tool.call', async ($, e, next) => {
      const reason = verdict(e.tool, e)
      if (reason === undefined) return next(e)
      s.stats.blocked++
      await flush($, s)
      return { deny: reason }
    })
  }

  on('command.run', { command: 'agentdb' }, async ($, e) => {
    const text = await answer(typeof e.args === 'string' ? e.args : '', {
      opts: s.opts,
      stats: s.stats,
      nowMs: () => $.clock.now(),
      read: async query => {
        const got = await read($, s, query, Math.max(s.opts.recallDeadlineMs, 2000))
        return got === 'late' ? undefined : got
      },
    })
    return { text }
  })
}
