import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../src/output.js', () => ({ output: new Proxy({}, { get: () => vi.fn() }) }));
vi.mock('../src/prompt.js', () => ({ confirm: vi.fn(async () => true), select: vi.fn(), input: vi.fn() }));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: vi.fn(), MCPClientError: class extends Error {} }));
import { memoryCommand } from '../src/commands/memory.js';
import { _resetMemoryRootCache, initializeMemoryDatabase, storeEntry, listEntries } from '../src/memory/memory-initializer.js';

let dir: string;
let primary: string;
let mirror: string;
async function invoke(name: string, flags: Record<string, unknown> = {}) {
  return memoryCommand.subcommands!.find(c => c.name === name)!.action!({
    flags: { namespace: 'scratch', key: 'remove', force: true, ...flags }, args: [], interactive: false,
  } as never);
}
async function count(dbPath: string, namespace = 'scratch') {
  return (await listEntries({ dbPath, namespace })).total;
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'memory-cli-mirror-'));
  vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', dir);
  vi.stubEnv('CLAUDE_FLOW_DISABLE_BRIDGE', '1');
  vi.stubEnv('CLAUDE_FLOW_DB_PATH', '');
  _resetMemoryRootCache();
  primary = join(dir, 'memory.db');
  mirror = join(dir, 'agentdb-memory.db');
  for (const dbPath of [primary, mirror]) {
    expect((await initializeMemoryDatabase({ dbPath, force: true, migrate: false })).success).toBe(true);
    for (const namespace of ['scratch', 'keep']) {
      expect((await storeEntry({ dbPath, namespace, key: 'remove', value: namespace, generateEmbeddingFlag: false })).success).toBe(true);
    }
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetMemoryRootCache();
  rmSync(dir, { recursive: true, force: true });
});

describe('CLI removal of default memory and its AgentDB mirror', () => {
  it.each(['delete', 'purge'])('%s removes matching entries from both stores', async (command) => {
    expect((await invoke(command)).success).toBe(true);
    expect(await count(primary)).toBe(0);
    expect(await count(mirror)).toBe(0);
    expect(await count(primary, 'keep')).toBe(1);
    expect(await count(mirror, 'keep')).toBe(1);
  });

  it('refuses an unconfirmed purge without changing either store', async () => {
    expect(await invoke('purge', { force: false })).toMatchObject({ success: false, exitCode: 1 });
    expect(await count(primary)).toBe(1);
    expect(await count(mirror)).toBe(1);
  });

  it('previews both stores without modifying either', async () => {
    const result = await invoke('purge', { dryRun: true });
    expect(result.data).toMatchObject({ wouldDelete: 2 });
    expect(await count(primary)).toBe(1);
    expect(await count(mirror)).toBe(1);
  });

  it.each(['delete', 'purge'])('%s honors an explicit single-store path', async (command) => {
    expect((await invoke(command, { path: primary })).success).toBe(true);
    expect(await count(primary)).toBe(0);
    expect(await count(mirror)).toBe(1);
  });

  it.each(['delete', 'purge'])('%s honors the environment single-store override', async (command) => {
    vi.stubEnv('CLAUDE_FLOW_DB_PATH', primary);
    expect((await invoke(command)).success).toBe(true);
    expect(await count(mirror)).toBe(1);
  });

  it.each(['delete', 'purge'])('%s reports a failure if the mirror cannot be modified', async (command) => {
    writeFileSync(mirror, 'not a database');
    expect(await invoke(command)).toMatchObject({ success: false, exitCode: 1 });
  });

  it('can remove mirror-only rows when the primary store is absent', async () => {
    rmSync(primary);
    expect((await invoke('purge')).success).toBe(true);
    expect(await count(mirror)).toBe(0);
  });
});
