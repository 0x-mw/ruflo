/**
 * What the console's model tools may never do on their own (ADR-450 T8, T12): auto-confirm a network, spend or delete action, pass text that
 * looks like a secret, or let an environment variable raise Claude's control above what the person saved.
 */
import { describe, expect, it } from 'vitest'

import { allows, callTool, lowerOnly, parseControlEnv } from '../hooks/model-tools'
import { setup } from './fixtures/control-setup'

describe('what auto-confirm may never answer (ADR-450 T8)', () => {
  const ENTRIES = { read: 'mission-open', write: 'mission-create', network: 'plugin-install', spend: 'hand-task', delete: 'mission-cancel' } as const
  const levels = ['read', 'write', 'manage', 'full'] as const

  for (const kind of ['read', 'write', 'network', 'spend', 'delete'] as const) {
    for (const confirm of ['ask', 'auto'] as const) {
      for (const level of levels) {
        const refused = !allows(level, kind)
        const waits = !refused && kind !== 'read' && (confirm === 'ask' || kind !== 'write')

        it(`${kind} at ${level}:${confirm} is ${refused ? 'refused' : waits ? 'left waiting for the person' : 'run'}`, async () => {
          const { deps, calls, state } = setup(level, confirm)
          const answer = await callTool('console_run', { id: ENTRIES[kind] }, deps)

          if (refused) expect(answer).toMatch(/^Refused: .*needs/)
          else if (waits) expect(answer).toMatch(/^Waiting for the person to confirm/)
          else expect(answer).toMatch(/^Done/)

          expect(calls.confirm).toBe(!refused && !waits && kind !== 'read' ? 1 : 0)
          expect(state.pending !== null).toBe(waits)
        })
      }
    }
  }

  it('never confirms a network, spend or delete action in auto, however many times Claude asks', async () => {
    const { deps, calls } = setup('full', 'auto')

    for (const id of ['plugin-install', 'hand-task', 'mission-cancel']) {
      expect(await callTool('console_run', { id }, deps), id).toMatch(/^Waiting for the person to confirm/)
      deps.state.pending = null
    }
    expect(calls.confirm).toBe(0)
  })
})

describe('text Claude passes is screened for secrets before it reaches an entry (ADR-450 T8)', () => {
  const TOKEN = `ghp_${'a1B2c3D4e5'.repeat(4)}`
  const SECRETS = [TOKEN, 'AKIAABCDEFGHIJKLMNOP', '-----BEGIN OPENSSH PRIVATE KEY-----', 'password=hunter2hunter2hunter2', `sk-ant-${'x'.repeat(30)}`, `xoxb-${'1'.repeat(12)}`]

  for (const secret of SECRETS) {
    it(`refuses a run whose text holds ${secret.slice(0, 8)}… and runs nothing, never echoing it`, async () => {
      const { deps, calls, state } = setup('manage', 'auto')
      const answer = await callTool('console_run', { id: 'mission-create', text: `post this: ${secret}` }, deps)

      expect(answer).toBe('Refused: that text looks like a secret. It was not used and is not shown. Do not pass keys, tokens or passwords to the console.')
      expect(answer).not.toContain(secret)
      expect(calls.runs).toEqual([])
      expect(JSON.stringify(state.control.log)).not.toContain(secret)
    })

    it(`refuses a set whose value holds ${secret.slice(0, 8)}… and fills nothing`, async () => {
      const { deps, calls } = setup('write', 'auto')
      const answer = await callTool('console_set', { field: 'goal', value: `use ${secret}` }, deps)

      expect(answer).toMatch(/^Refused: that text looks like a secret/)
      expect(answer).not.toContain(secret)
      expect(calls.goal).toEqual([])
    })
  }

  it('hides a secret behind zero-width characters no better', async () => {
    const { deps, calls } = setup('write', 'auto')

    expect(await callTool('console_run', { id: 'mission-create', text: `gh\u200bp_${'a1B2c3D4e5'.repeat(4)}` }, deps)).toMatch(/^Refused: that text looks like a secret/)
    expect(calls.runs).toEqual([])
  })

  it('still runs and sets clean text', async () => {
    const { deps, calls } = setup('write', 'auto')

    expect(await callTool('console_set', { field: 'goal', value: 'add a dark mode toggle' }, deps)).toMatch(/^Set goal/)
    expect(await callTool('console_run', { id: 'mission-create', text: 'a normal note about tokens in general' }, deps)).toMatch(/^Done/)
    expect(calls.goal).toEqual(['add a dark mode toggle'])
    expect(calls.runs).toEqual(['mission-create'])
  })
})

describe('the environment override may only lower control (ADR-450 T12)', () => {
  const levels = ['off', 'read', 'write', 'manage', 'full'] as const
  const rank = (level: (typeof levels)[number]) => levels.indexOf(level)

  for (const saved of levels) {
    for (const forced of levels) {
      for (const savedConfirm of ['ask', 'auto'] as const) {
        for (const forcedConfirm of ['ask', 'auto'] as const) {
          it(`saved ${saved}:${savedConfirm} with env ${forced}:${forcedConfirm}`, () => {
            const got = lowerOnly({ level: saved, confirm: savedConfirm }, { level: forced, confirm: forcedConfirm })

            expect(rank(got.level)).toBeLessThanOrEqual(rank(saved))
            expect(rank(got.level)).toBeLessThanOrEqual(rank(forced))
            expect(got.level).toBe(rank(forced) < rank(saved) ? forced : saved)
            expect(got.confirm).toBe(savedConfirm === 'ask' || forcedConfirm === 'ask' ? 'ask' : 'auto')
          })
        }
      }
    }
  }

  it('leaves the saved setting alone when there is no override, and cannot turn control on from off', () => {
    expect(lowerOnly({ level: 'write', confirm: 'ask' }, null)).toEqual({ level: 'write', confirm: 'ask' })
    expect(lowerOnly({ level: 'off', confirm: 'auto' }, parseControlEnv('full:auto'))).toEqual({ level: 'off', confirm: 'auto' })
    expect(lowerOnly({ level: 'read', confirm: 'ask' }, parseControlEnv('full:auto'))).toEqual({ level: 'read', confirm: 'ask' })
  })
})

