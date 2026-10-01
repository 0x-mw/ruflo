// @ts-check
/**
 * Shared types and the typed error for ruflo-ruos (ADR-405).
 *
 * Plain .mjs with JSDoc so the plugin needs no build step; `tsc --checkJs`
 * type-checks it (see scripts/typecheck.sh).
 */

/**
 * A desktop the caller owns, normalised from the fleet `desktop_status` tool.
 * @typedef {object} Desktop
 * @property {string} id              fleet registry machine id (32 hex)
 * @property {string|null} flyMachineId  Fly machine id (14 hex) or null for enrolled endpoints
 * @property {string} name
 * @property {string|null} displayName
 * @property {string|null} state       last observed Fly run state ('started', 'stopped', ...)
 * @property {string|null} heartbeatStatus  'asleep' | 'stale' | 'missing' | other (live)
 * @property {number|null} heartbeatAt  unix seconds of the last heartbeat
 * @property {boolean} ready           provisioning flag — NOT liveness
 */

/**
 * The single seam between the adapter and a remote desktop. Both transports
 * run the same one-line shell strings produced by command-builder.mjs.
 * @typedef {object} ExecResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {number|null} exitCode
 */

/**
 * @typedef {object} Transport
 * @property {'fleet-mcp'|'ssh'} kind
 * @property {(desktop: Desktop, command: string, timeoutSecs: number) => Promise<ExecResult>} exec
 */

/**
 * Fleet control-plane calls (always the tenant-authenticated fleet MCP).
 * @typedef {object} Fleet
 * @property {() => Promise<Desktop[]>} listDesktops
 * @property {(id: string) => Promise<void>} start
 * @property {(id: string) => Promise<void>} stop
 * @property {(flyMachineId: string|null, minutes: number) => Promise<void>} keepAwake
 */

/**
 * What the swarm ledger records about one remote agent.
 * @typedef {object} HostRef
 * @property {'ruos'} kind
 * @property {string} desktopId
 * @property {string} desktopName
 * @property {'fleet-mcp'|'ssh'} transport
 * @property {string} runId
 */

/**
 * @typedef {object} RunSpec
 * @property {string} runId
 * @property {string} prompt
 * @property {'claude'} runner
 * @property {('haiku'|'sonnet'|'opus')=} model
 * @property {number=} maxBudgetUsd
 */

/**
 * @typedef {'run.started'|'run.output'|'run.completed'|'run.failed'|'run.stopped'|'desktop.state'} EventType
 */

/**
 * Event-log row. Carries ids, sizes and states only — never prompt text or
 * agent output (those stay in the per-run local log, mode 0600).
 * @typedef {object} RuosEvent
 * @property {string} ts
 * @property {EventType} type
 * @property {string=} runId
 * @property {string=} agentId
 * @property {string=} desktopId
 * @property {string=} desktopName
 * @property {number=} bytes
 * @property {number|null=} exitCode
 * @property {string=} error
 * @property {string=} state
 */

/** @typedef {'not-configured'|'invalid-input'|'not-owned'|'ambiguous'|'confirm-required'|'auth-expired'|'network-down'|'desktop-stopped'|'auto-stopped'|'autostop-window'|'tool-error'|'remote-error'|'timeout'} RuosErrorCode */

export class RuosError extends Error {
  /**
   * @param {RuosErrorCode} code
   * @param {string} message
   * @param {unknown=} cause
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'RuosError';
    /** @type {RuosErrorCode} */
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}
