// @ts-check
/**
 * Job transports (ADR-405 §Jobs). The adapter drives a JobTransport; two
 * implementations:
 *
 *  - ExecPollTransport — available now. Stages the prompt and launches a
 *    detached `nohup setsid` runner via desktop_exec, then polls the log by
 *    byte offset. All strings come from command-builder.mjs.
 *  - JobsApiTransport — ruOS ADR-105 jobs API (`feat/ruos-jobs`), used when
 *    feature-detected. The server owns detach, capture, exit, cancel,
 *    keepawake and audit. Backends: REST with the tenant token, or the local
 *    stdio `@cognitum/ruos` MCP server (`desktop_job_*` — stdio-only, never on
 *    the remote connector). The run id is the idempotency key.
 */
import { RuosError } from './types.mjs';
import { assertRunId, assertInt } from './validate.mjs';
import {
  buildPrepare, buildPromptChunks, buildLaunch, buildPoll, buildStop, buildJobCommand,
  parsePoll, parseLaunch, parseStopped, commandSha256,
} from './command-builder.mjs';

/**
 * @param {import('./types.mjs').Transport} exec
 * @param {import('./types.mjs').Desktop} desktop
 * @param {import('./types.mjs').RunSpec} spec
 */
async function stagePrompt(exec, desktop, spec) {
  const chunks = buildPromptChunks(spec.runId, spec.prompt);
  const run = async (/** @type {string} */ c) => {
    const r = await exec.exec(desktop, c, 30);
    if (r.exitCode !== null && r.exitCode !== 0) throw new RuosError('remote-error', `staging failed (exit ${r.exitCode})`);
    return r;
  };
  await run(buildPrepare(spec.runId));
  for (const c of chunks.commands) await run(c);
  return chunks;
}

/**
 * @param {import('./types.mjs').Transport} exec
 * @returns {import('./types.mjs').JobTransport}
 */
export function createExecPollTransport(exec) {
  return {
    kind: 'exec-poll',
    async start(desktop, spec) {
      const chunks = await stagePrompt(exec, desktop, spec);
      const cmd = buildLaunch(spec);
      const lr = await exec.exec(desktop, cmd, 60);
      const launched = parseLaunch(lr.stdout);
      if (launched.noRunner) throw new RuosError('remote-error', 'claude is not installed on the desktop');
      if (lr.exitCode !== null && lr.exitCode !== 0) throw new RuosError('remote-error', `launch failed (exit ${lr.exitCode})`);
      if (launched.sha256 !== chunks.sha256) throw new RuosError('remote-error', 'prompt integrity check failed (sha256 mismatch)');
      if (launched.pid === null) throw new RuosError('remote-error', 'runner did not report a pid');
      return { jobId: spec.runId, commandSha256: commandSha256(cmd) };
    },
    async poll(desktop, jobId, offset) {
      const p = parsePoll((await exec.exec(desktop, buildPoll(jobId, offset), 30)).stdout);
      if (p === 'norun') throw new RuosError('remote-error', 'run directory vanished on the desktop');
      const next = offset + p.chunk.length;
      /** @type {import('./types.mjs').JobState} */
      const state = p.exitCode !== null ? (p.exitCode === 0 ? 'exited' : 'failed') : p.alive ? 'running' : 'lost';
      return { chunk: p.chunk, nextOffset: next, running: state === 'running', state, exitCode: p.exitCode, truncated: false };
    },
    async cancel(desktop, jobId) {
      return parseStopped((await exec.exec(desktop, buildStop(jobId), 30)).stdout);
    },
  };
}

/**
 * Minimal backend contract for the jobs API (REST or stdio MCP adapter).
 * @typedef {object} JobsBackend
 * @property {(body: { machine: string, command: string, timeout_secs: number, idempotency_key: string }) => Promise<{ job_id: string }>} create
 * @property {(jobId: string, offset: number, max: number) => Promise<{ chunk: string, next_offset: number, running: boolean, state: string, exit_code: number|null, truncated: boolean }>} read
 * @property {(jobId: string) => Promise<void>} cancel
 * @property {(machine: string) => Promise<unknown[]>} list
 */

const STATES = new Set(['queued', 'running', 'exited', 'failed', 'cancelled', 'stopped', 'lost']);
export const JOBS_CHUNK_MAX = 65536;

/**
 * @param {JobsBackend} backend
 * @param {import('./types.mjs').Transport} exec  used only to stage the prompt file
 * @returns {import('./types.mjs').JobTransport}
 */
export function createJobsApiTransport(backend, exec) {
  return {
    kind: 'jobs-api',
    async start(desktop, spec) {
      await stagePrompt(exec, desktop, spec);
      const command = buildJobCommand(spec);
      const { job_id } = await backend.create({
        machine: desktop.flyMachineId ?? desktop.id,
        command,
        timeout_secs: assertInt(spec.timeoutSecs, 1, 21600, 'timeoutSecs'),
        idempotency_key: assertRunId(spec.runId),
      });
      if (typeof job_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(job_id)) throw new RuosError('remote-error', 'jobs API returned an invalid job id');
      return { jobId: job_id, commandSha256: commandSha256(command) };
    },
    async poll(_desktop, jobId, offset) {
      const r = await backend.read(jobId, offset, JOBS_CHUNK_MAX);
      const state = STATES.has(r.state) ? /** @type {import('./types.mjs').JobState} */ (r.state) : 'lost';
      const chunk = Buffer.from(String(r.chunk ?? ''), 'base64');
      // Trust byte offsets, not chunk length: the server may skip a capped tail.
      const nextOffset = typeof r.next_offset === 'number' && r.next_offset >= offset ? r.next_offset : offset + chunk.length;
      return { chunk, nextOffset, running: r.running === true, state, exitCode: typeof r.exit_code === 'number' ? r.exit_code : null, truncated: r.truncated === true };
    },
    async cancel(_desktop, jobId) {
      await backend.cancel(jobId);
      return true;
    },
  };
}

/**
 * REST backend for the jobs API with the tenant token. Status mapping:
 * 401 → auth-expired, 403 → insufficient-scope, 404 → not-owned (another
 * tenant's id or gone — never retried), 409/429 → capacity (per-tenant
 * RUOS_JOBS_MAX_CONCURRENT cap; the adapter backs off).
 * @param {{ baseUrl: string, token: string, fetchImpl?: typeof fetch }} o
 * @returns {JobsBackend & { detect: (machine: string) => Promise<boolean> }}
 */
export function createRestJobsBackend(o) {
  const f = o.fetchImpl ?? globalThis.fetch;
  const base = new URL('/api/v1/desktop/jobs', o.baseUrl).toString();
  /**
   * @param {string} method
   * @param {string} url
   * @param {unknown=} body
   */
  const call = async (method, url, body) => {
    /** @type {Response} */
    let res;
    try {
      res = await f(url, {
        method,
        headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new RuosError('network-down', 'ruOS jobs API unreachable');
    }
    if (res.status === 401) throw new RuosError('auth-expired', 'jobs API refused the credential');
    if (res.status === 403) throw new RuosError('insufficient-scope', 'jobs API needs a desktop:control token');
    if (res.status === 404) throw new RuosError('not-owned', 'job not found (not yours, or gone)');
    if (res.status === 409 || res.status === 429) throw new RuosError('capacity', 'per-tenant job concurrency cap reached');
    if (!res.ok) throw new RuosError('tool-error', `jobs API HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  };
  /** @param {string} id */
  const jobUrl = (id) => `${base}/${encodeURIComponent(id)}`;
  return {
    create: (body) => call('POST', base, body),
    read: (id, offset, max) => call('GET', `${jobUrl(id)}?offset=${offset}&max=${max}`),
    cancel: async (id) => { await call('DELETE', jobUrl(id)); },
    list: async (machine) => {
      const r = await call('GET', `${base}?machine=${encodeURIComponent(machine)}`);
      return Array.isArray(r.jobs) ? r.jobs : Array.isArray(r) ? r : [];
    },
    /** Feature detection: the list route exists → the jobs API is deployed. */
    detect: async (machine) => {
      try {
        await call('GET', `${base}?machine=${encodeURIComponent(machine)}`);
        return true;
      } catch (e) {
        if (e instanceof RuosError && (e.code === 'auth-expired' || e.code === 'insufficient-scope')) throw e;
        return false;
      }
    },
  };
}
