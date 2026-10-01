// @ts-check
/**
 * ruOS host adapter (ADR-405): discover → (opt-in start) → launch → stream →
 * stop, with typed failures. Collaborators are injected (London-school):
 * Fleet (control plane), Transport (exec), Ledger (swarm state), clock.
 */
import { RuosError } from './types.mjs';
import { resolveDesktop, assertRunId, assertAgentId, assertInt } from './validate.mjs';
import {
  buildPrepare, buildPromptChunks, buildLaunch, buildPoll, buildStop, parsePoll, parseLaunch,
} from './command-builder.mjs';
import { checkWindow } from './autostop.mjs';

/** heartbeat older than this is not evidence the desktop is up */
export const HEARTBEAT_FRESH_SECS = 180;

/**
 * @param {import('./types.mjs').Desktop} d
 * @param {number} nowMs
 */
export function isUp(d, nowMs) {
  if (d.heartbeatStatus && ['asleep', 'missing', 'stale'].includes(d.heartbeatStatus)) return false;
  if (d.heartbeatAt === null) return false;
  return nowMs / 1000 - d.heartbeatAt <= HEARTBEAT_FRESH_SECS;
}

/**
 * @typedef {object} AdapterDeps
 * @property {import('./types.mjs').Fleet} fleet
 * @property {import('./types.mjs').Transport} transport
 * @property {import('./ledger.mjs').Ledger} ledger
 * @property {() => number=} now
 * @property {(ms: number) => Promise<void>=} sleep
 */

/**
 * @typedef {object} RunOptions
 * @property {string} desktop        desktop reference (id, fly id or name)
 * @property {string} prompt
 * @property {string} runId
 * @property {string} agentId
 * @property {string=} agentType
 * @property {('haiku'|'sonnet'|'opus')=} model
 * @property {number=} maxBudgetUsd
 * @property {number=} timeoutSecs   wall-clock cap for the whole run
 * @property {boolean=} allowStart   opt-in: wake a stopped desktop
 * @property {boolean=} ignoreAutoStop
 * @property {(chunk: Buffer) => void=} onOutput
 * @property {AbortSignal=} signal
 */

/**
 * @typedef {object} RunOutcome
 * @property {string} runId
 * @property {string} agentId
 * @property {string} desktopId
 * @property {'completed'|'failed'|'stopped'} status
 * @property {number|null} exitCode
 * @property {number} bytes
 * @property {number} dispatchMs     local call → launch acknowledged
 * @property {number|null} firstOutputMs  local call → first output byte
 * @property {number} totalMs
 * @property {string} swarmLedger
 * @property {string[]} warnings
 */

export class RuosHostAdapter {
  /** @param {AdapterDeps} deps */
  constructor(deps) {
    this.fleet = deps.fleet;
    this.transport = deps.transport;
    this.ledger = deps.ledger;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async discover() {
    const desktops = await this.fleet.listDesktops();
    this.ledger.snapshotHosts(desktops, {});
    return desktops;
  }

  /** @param {string} ref */
  async resolve(ref) {
    return resolveDesktop(await this.fleet.listDesktops(), ref);
  }

  /**
   * Wake a stopped desktop only when the caller opted in; then wait for a
   * FRESH heartbeat (`ready` is a provisioning flag, not liveness).
   * @param {import('./types.mjs').Desktop} desktop
   * @param {{ allowStart?: boolean, waitSecs?: number }} o
   */
  async ensureUp(desktop, o) {
    if (isUp(desktop, this.now())) return desktop;
    if (!o.allowStart) {
      throw new RuosError('desktop-stopped', `desktop ${desktop.displayName ?? desktop.name} is not running; pass --start to wake it (billable)`);
    }
    if (!desktop.flyMachineId) {
      throw new RuosError('desktop-stopped', 'desktop is an enrolled endpoint without a cloud machine; start it on the device');
    }
    await this.fleet.start(desktop.id);
    this.ledger.event({ type: 'desktop.state', desktopId: desktop.id, state: 'starting' });
    const deadline = this.now() + (o.waitSecs ?? 180) * 1000;
    let delay = 2000;
    while (this.now() < deadline) {
      await this.sleep(delay);
      delay = Math.min(delay * 1.5, 10_000);
      const fresh = resolveDesktop(await this.fleet.listDesktops(), desktop.id);
      if (isUp(fresh, this.now())) {
        this.ledger.event({ type: 'desktop.state', desktopId: desktop.id, state: 'started' });
        return fresh;
      }
    }
    throw new RuosError('timeout', 'desktop did not report a fresh heartbeat after start');
  }

  /**
   * @param {import('./types.mjs').Desktop} desktop
   * @param {string} command
   * @param {number=} timeoutSecs
   */
  async exec(desktop, command, timeoutSecs = 30) {
    const r = await this.transport.exec(desktop, command, timeoutSecs);
    if (r.exitCode !== null && r.exitCode !== 0) {
      throw new RuosError('remote-error', `remote command failed (exit ${r.exitCode}): ${(r.stdout + r.stderr).slice(0, 200)}`);
    }
    return r;
  }

  /**
   * After a transport failure mid-run: did the desktop stop under us?
   * @param {import('./types.mjs').Desktop} desktop
   * @param {unknown} err
   */
  async classifyMidRun(desktop, err) {
    if (err instanceof RuosError && (err.code === 'auth-expired' || err.code === 'invalid-input')) return err;
    try {
      const fresh = resolveDesktop(await this.fleet.listDesktops(), desktop.id);
      if (!isUp(fresh, this.now())) {
        return new RuosError('auto-stopped', 'desktop stopped mid-run (weekday 23:00 America/Toronto auto-stop or idle autosleep)', err);
      }
    } catch (probeErr) {
      if (probeErr instanceof RuosError && probeErr.code === 'auth-expired') return probeErr;
    }
    return err instanceof RuosError ? err : new RuosError('remote-error', String(err), err);
  }

  /**
   * @param {RunOptions} o
   * @returns {Promise<RunOutcome>}
   */
  async run(o) {
    const t0 = this.now();
    const runId = assertRunId(o.runId);
    const agentId = assertAgentId(o.agentId);
    const agentType = assertAgentId(o.agentType ?? 'coder');
    const timeoutSecs = assertInt(o.timeoutSecs ?? 900, 30, 6 * 3600, 'timeoutSecs');

    const win = checkWindow(t0, timeoutSecs);
    if (!win.ok && !o.ignoreAutoStop) {
      throw new RuosError('autostop-window', `run may outlast the next auto-stop in ${win.minutesUntilStop} min (weekday 23:00 America/Toronto); shorten --timeout or pass --ignore-autostop`);
    }

    let desktop = await this.resolve(o.desktop);
    desktop = await this.ensureUp(desktop, { allowStart: o.allowStart });
    const name = desktop.displayName ?? desktop.name;
    /** @type {import('./types.mjs').HostRef} */
    const host = { kind: 'ruos', desktopId: desktop.id, desktopName: name, transport: this.transport.kind, runId };

    const chunks = buildPromptChunks(runId, o.prompt); // validates the prompt before any remote call
    const claimed = await this.ledger.claim(runId, agentId, agentType);
    if (!claimed) throw new RuosError('invalid-input', `run ${runId} is already claimed`);
    await this.ledger.registerAgent(agentId, agentType, host, o.prompt);
    this.ledger.snapshotHosts([desktop], { [desktop.id]: [agentId] });

    let bytes = 0;
    /** @type {number|null} */ let firstOutputMs = null;
    let dispatchMs = 0;
    /** @type {RunOutcome['status']} */ let status = 'failed';
    /** @type {number|null} */ let exitCode = null;
    try {
      await this.exec(desktop, buildPrepare(runId));
      for (const c of chunks.commands) await this.exec(desktop, c);
      const lr = await this.transport.exec(desktop, buildLaunch({ runId, prompt: o.prompt, runner: 'claude', model: o.model, maxBudgetUsd: o.maxBudgetUsd }), 60);
      const launched = parseLaunch(lr.stdout);
      if (launched.noRunner) throw new RuosError('remote-error', 'claude is not installed on the desktop');
      if (lr.exitCode !== null && lr.exitCode !== 0) throw new RuosError('remote-error', `launch failed (exit ${lr.exitCode})`);
      if (launched.sha256 !== chunks.sha256) throw new RuosError('remote-error', 'prompt integrity check failed (sha256 mismatch)');
      if (launched.pid === null) throw new RuosError('remote-error', 'runner did not report a pid');
      dispatchMs = this.now() - t0;
      this.ledger.event({ type: 'run.started', runId, agentId, desktopId: desktop.id, desktopName: name });
      if (desktop.flyMachineId) {
        await this.fleet.keepAwake(desktop.flyMachineId, Math.min(1440, Math.ceil(timeoutSecs / 60) + 5)).catch(() => {
          this.ledger.warnings.push('keepawake failed; idle autosleep may stop the run');
        });
      }

      let offset = 0;
      let delay = 1000;
      for (;;) {
        if (o.signal?.aborted) {
          await this.transport.exec(desktop, buildStop(runId), 30).catch(() => {});
          status = 'stopped';
          break;
        }
        if (this.now() - t0 > timeoutSecs * 1000) {
          await this.transport.exec(desktop, buildStop(runId), 30).catch(() => {});
          throw new RuosError('timeout', `run exceeded ${timeoutSecs}s and was stopped`);
        }
        const p = parsePoll((await this.transport.exec(desktop, buildPoll(runId, offset), 30)).stdout);
        if (p === 'norun') throw new RuosError('remote-error', 'run directory vanished on the desktop');
        if (p.chunk.length > 0) {
          if (firstOutputMs === null) firstOutputMs = this.now() - t0;
          offset += p.chunk.length;
          bytes += p.chunk.length;
          this.ledger.appendOutput(runId, p.chunk);
          o.onOutput?.(p.chunk);
          this.ledger.event({ type: 'run.output', runId, agentId, desktopId: desktop.id, bytes: p.chunk.length });
          delay = 1000;
        }
        if (p.exitCode !== null && offset >= p.size) {
          exitCode = p.exitCode;
          status = exitCode === 0 ? 'completed' : 'failed';
          break;
        }
        if (p.chunk.length === 0) {
          await this.sleep(delay);
          delay = Math.min(delay * 1.5, 5000);
        }
      }
    } catch (err) {
      const e = await this.classifyMidRun(desktop, err);
      this.ledger.event({ type: 'run.failed', runId, agentId, desktopId: desktop.id, error: e.code ?? 'remote-error' });
      await this.finish(agentId, agentType, runId, 'failed', null, bytes);
      throw e;
    }
    this.ledger.event({
      type: status === 'stopped' ? 'run.stopped' : status === 'completed' ? 'run.completed' : 'run.failed',
      runId, agentId, desktopId: desktop.id, exitCode, bytes,
    });
    await this.finish(agentId, agentType, runId, status, exitCode, bytes);
    return {
      runId, agentId, desktopId: desktop.id, status, exitCode, bytes, dispatchMs, firstOutputMs,
      totalMs: this.now() - t0, swarmLedger: this.ledger.swarmLedger, warnings: [...this.ledger.warnings],
    };
  }

  /**
   * @param {string} agentId
   * @param {string} agentType
   * @param {string} runId
   * @param {string} status
   * @param {number|null} exitCode
   * @param {number} bytes
   */
  async finish(agentId, agentType, runId, status, exitCode, bytes) {
    await this.ledger.updateAgent(agentId, 'idle', { runId, status, exitCode, bytes });
    await this.ledger.release(runId, agentId, agentType);
  }

  /**
   * Stop a run (its process group) — explicit confirm required.
   * @param {{ desktop: string, runId: string, confirm?: boolean }} o
   */
  async stopRun(o) {
    if (!o.confirm) throw new RuosError('confirm-required', 'stopping a run interrupts work; pass --confirm');
    const runId = assertRunId(o.runId);
    const desktop = await this.resolve(o.desktop);
    const r = await this.transport.exec(desktop, buildStop(runId), 30);
    const stopped = r.stdout.includes('RUOS_STOPPED');
    this.ledger.event({ type: 'run.stopped', runId, desktopId: desktop.id, state: stopped ? 'stopped' : 'not-running' });
    return { runId, desktopId: desktop.id, stopped };
  }

  /**
   * Stop the whole desktop — explicit confirm required (discards in-memory state).
   * @param {{ desktop: string, confirm?: boolean }} o
   */
  async stopDesktop(o) {
    if (!o.confirm) throw new RuosError('confirm-required', 'stopping a desktop interrupts all work on it; pass --confirm');
    const desktop = await this.resolve(o.desktop);
    await this.fleet.stop(desktop.id);
    this.ledger.event({ type: 'desktop.state', desktopId: desktop.id, state: 'stopping' });
    return { desktopId: desktop.id };
  }
}
