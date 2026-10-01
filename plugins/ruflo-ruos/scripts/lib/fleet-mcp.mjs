// @ts-check
/**
 * Fleet MCP transport (ADR-405 transport 1) — the tenant-authenticated ruOS
 * fleet MCP over streamable HTTP. The caller's own bearer comes from the
 * environment (RUOS_MCP_URL + RUOS_MCP_TOKEN); nothing is embedded, and with
 * either unset the client refuses before touching the network.
 *
 * This client never talks to a desktop directly. In particular it never
 * reaches the desktop executor on :17870 (no per-tenant auth, ADR-070).
 */
import { RuosError } from './types.mjs';
import { FLY_ID_RE, DESKTOP_ID_RE } from './validate.mjs';

const PROTOCOL_VERSION = '2025-06-18';

/**
 * @typedef {object} FleetMcpOptions
 * @property {string|undefined} url
 * @property {string|undefined} token
 * @property {typeof fetch=} fetchImpl
 * @property {number=} requestTimeoutMs
 */

/** @param {NodeJS.ProcessEnv} env */
export function fleetConfigFromEnv(env) {
  return { url: env.RUOS_MCP_URL || undefined, token: env.RUOS_MCP_TOKEN || undefined };
}

export class FleetMcpClient {
  /** @param {FleetMcpOptions} opts */
  constructor(opts) {
    this.url = opts.url;
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 330_000;
    /** @type {string|null} */
    this.sessionId = null;
    this.nextId = 1;
    /** @type {Promise<void>|null} */
    this.ready = null;
  }

  get configured() {
    return Boolean(this.url && this.token);
  }

  assertConfigured() {
    if (!this.configured) {
      throw new RuosError('not-configured', 'set RUOS_MCP_URL and RUOS_MCP_TOKEN to use the fleet MCP transport');
    }
    const u = new URL(/** @type {string} */ (this.url));
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'))) {
      throw new RuosError('invalid-input', 'RUOS_MCP_URL must be https (http only for localhost)');
    }
    if (u.port === '17870') throw new RuosError('invalid-input', 'refusing the desktop executor port :17870 (ADR-070)');
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>=} params
   * @param {boolean=} notification
   */
  async rpc(method, params, notification = false) {
    this.assertConfigured();
    /** @type {Record<string, string>} */
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${this.token}`,
      'mcp-protocol-version': PROTOCOL_VERSION,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    const body = notification
      ? { jsonrpc: '2.0', method, params: params ?? {} }
      : { jsonrpc: '2.0', id: this.nextId++, method, params: params ?? {} };
    /** @type {Response} */
    let res;
    try {
      res = await this.fetchImpl(/** @type {string} */ (this.url), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      const e = /** @type {Error} */ (err);
      if (e && e.name === 'TimeoutError') throw new RuosError('timeout', 'fleet MCP request timed out', err);
      throw new RuosError('network-down', 'fleet MCP unreachable', err);
    }
    if (res.status === 401 || res.status === 403) {
      throw new RuosError('auth-expired', `fleet MCP refused the credential (HTTP ${res.status}); refresh RUOS_MCP_TOKEN`);
    }
    if (!res.ok && res.status !== 202) {
      throw new RuosError('tool-error', `fleet MCP HTTP ${res.status}`);
    }
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (notification || res.status === 202) return undefined;
    const text = await res.text();
    const msg = parseRpcBody(text, res.headers.get('content-type') || '');
    if (msg.error) {
      const code = /unauthori|expired|invalid token/i.test(String(msg.error.message)) ? 'auth-expired' : 'tool-error';
      throw new RuosError(code, `fleet MCP error: ${String(msg.error.message).slice(0, 200)}`);
    }
    return msg.result;
  }

  async init() {
    if (!this.ready) {
      this.ready = (async () => {
        await this.rpc('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'ruflo-ruos', version: '0.1.0' },
        });
        await this.rpc('notifications/initialized', {}, true);
      })();
      this.ready.catch(() => { this.ready = null; });
    }
    return this.ready;
  }

  /**
   * Call a fleet tool and return its structured payload.
   * @param {string} name
   * @param {Record<string, unknown>} args
   * @returns {Promise<any>}
   */
  async callTool(name, args) {
    await this.init();
    const result = /** @type {any} */ (await this.rpc('tools/call', { name, arguments: args }));
    const payload = toolPayload(result);
    if (result && result.isError) {
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
      throw classifyToolError(text);
    }
    return payload;
  }
}

/**
 * @param {string} text
 * @param {string} contentType
 * @returns {{ result?: unknown, error?: { message?: unknown } }}
 */
export function parseRpcBody(text, contentType) {
  if (contentType.includes('text/event-stream')) {
    let last = null;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data) last = JSON.parse(data);
      }
    }
    if (!last) throw new RuosError('tool-error', 'empty SSE response from fleet MCP');
    return last;
  }
  return JSON.parse(text);
}

/** @param {any} result */
export function toolPayload(result) {
  if (!result) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const t = Array.isArray(result.content) ? result.content.find((/** @type {any} */ c) => c.type === 'text') : null;
  if (!t) return null;
  try {
    return JSON.parse(t.text);
  } catch {
    return t.text;
  }
}

/** @param {string} text */
export function classifyToolError(text) {
  const t = text.slice(0, 300);
  if (/unauthori|expired|forbidden|scope/i.test(t)) return new RuosError('auth-expired', `fleet: ${t}`);
  if (/not running|stopped|asleep|suspended|not started|no heartbeat/i.test(t)) return new RuosError('desktop-stopped', `fleet: ${t}`);
  if (/not found|not owned|unknown machine/i.test(t)) return new RuosError('not-owned', `fleet: ${t}`);
  if (/timed? ?out/i.test(t)) return new RuosError('timeout', `fleet: ${t}`);
  return new RuosError('tool-error', `fleet: ${t}`);
}

/**
 * @param {any} raw
 * @returns {import('./types.mjs').Desktop[]}
 */
export function normalizeDesktops(raw) {
  const list = raw && Array.isArray(raw.desktops) ? raw.desktops : [];
  return list
    .filter((/** @type {any} */ d) => typeof d.machine_id === 'string' && DESKTOP_ID_RE.test(d.machine_id))
    .map((/** @type {any} */ d) => ({
      id: d.machine_id,
      flyMachineId: typeof d.fly_machine_id === 'string' && FLY_ID_RE.test(d.fly_machine_id) ? d.fly_machine_id : null,
      name: String(d.name ?? ''),
      displayName: d.display_name ? String(d.display_name) : null,
      state: d.state ?? null,
      heartbeatStatus: d.heartbeat_status ?? null,
      heartbeatAt: typeof d.last_heartbeat_at === 'number' ? d.last_heartbeat_at : null,
      ready: d.ready === true,
    }));
}

/**
 * @param {any} raw
 * @returns {import('./types.mjs').ExecResult}
 */
export function normalizeExec(raw) {
  if (typeof raw === 'string') return { stdout: raw, stderr: '', exitCode: null };
  const r = raw ?? {};
  const exit = r.exit_code ?? r.exitCode ?? r.code ?? r.status;
  return {
    stdout: String(r.stdout ?? r.output ?? ''),
    stderr: String(r.stderr ?? ''),
    exitCode: typeof exit === 'number' ? exit : null,
  };
}

/**
 * Fleet control-plane operations bound to one client.
 * @param {FleetMcpClient} client
 * @returns {import('./types.mjs').Fleet}
 */
export function createFleet(client) {
  return {
    listDesktops: async () => normalizeDesktops(await client.callTool('desktop_status', {})),
    start: async (id) => { await client.callTool('desktop_start', { machine_id: id }); },
    stop: async (id) => { await client.callTool('desktop_stop', { machine_id: id }); },
    keepAwake: async (fly, minutes) => {
      await client.callTool('desktop_keepawake', { machine: fly, minutes });
    },
  };
}

/**
 * @param {FleetMcpClient} client
 * @returns {import('./types.mjs').Transport}
 */
export function createFleetTransport(client) {
  return {
    kind: 'fleet-mcp',
    exec: async (desktop, command, timeoutSecs) => {
      const timeout = Math.max(1, Math.min(300, Math.floor(timeoutSecs)));
      // desktop_exec's `machine` takes the Fly machine id (desktop_connect_info).
      const machine = desktop.flyMachineId ?? desktop.id;
      return normalizeExec(await client.callTool('desktop_exec', { command, machine, timeout_secs: timeout }));
    },
  };
}
