/**
 * What the Plugins page can do to a ruflo plugin or to the marketplace, as asks: each is one fixed `claude plugin ...` argv (verbs
 * checked against `claude plugin --help`), shown on the confirm row before it runs, never a ruflo CLI call. The plugin name is one
 * word from the marketplace clone's listing, validated here, and always qualified with the ruflo marketplace so another marketplace's
 * plugin of the same name is never touched. Tested in tests/plugin-ops.spec.ts.
 */
import type { ActionSpec } from './actions'

export type PluginOp = 'install' | 'update' | 'enable' | 'disable' | 'refresh'

const MARKET = 'ruflo'
const NAME = /^[a-z0-9][a-z0-9._-]{0,59}$/

export const PLUGIN_OP_LABEL: Record<PluginOp, string> = { install: 'install', update: 'update', enable: 'enable', disable: 'disable', refresh: 'update the marketplace' }

/** The ask for `op` on `name` (ignored by `refresh`), or null when the name is not one word of the shape a plugin has. */
export function pluginSpec(op: PluginOp, name = ''): ActionSpec | null {
  if (op === 'refresh') {
    return {
      label: `update the ${MARKET} marketplace clone (git pull of the plugin list: network)`,
      args: [],
      argv: ['claude', 'plugin', 'marketplace', 'update', MARKET],
      shows: `claude plugin marketplace update ${MARKET}`,
      expect: 'a newer clone of the ruflo marketplace',
      note: 'NETWORK: pulls the marketplace from GitHub',
      timeoutMs: 120_000,
    }
  }

  if (!NAME.test(name)) return null

  const id = `${name}@${MARKET}`
  const label = { install: `install ${id} (writes Claude Code's plugin records; network)`, update: `update ${id} (network)`, enable: `enable ${id}`, disable: `disable ${id}` }[op]

  return {
    label,
    args: [],
    argv: ['claude', 'plugin', op, id],
    shows: `claude plugin ${op} ${id}`,
    expect: op === 'install' ? `${id} in the installed plugins` : `${id} ${op}d`,
    note: op === 'install' || op === 'update' ? 'NETWORK: fetches the plugin; it loads in the next session' : 'takes effect in the next session',
    ...(op === 'install' && { verify: snapshot => (snapshot.plugins.installed ?? []).some(plugin => plugin.id === id) }),
    timeoutMs: 120_000,
  }
}
