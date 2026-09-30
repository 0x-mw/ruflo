/**
 * Regression for #3570 — `memory export` and `memory purge` reject a namespace
 * containing `../`, but `memory store` and `memory import` accepted and wrote
 * it, leaving a namespace the read-out and cleanup commands refuse to touch.
 * The write paths must reject it with the same message the export path uses.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mocks = vi.hoisted(() => ({
  checkMemoryInitialization: vi.fn(),
  initializeMemoryDatabase: vi.fn(),
  storeEntry: vi.fn(),
}));

vi.mock('../src/memory/memory-initializer.js', () => ({
  resolveDbPath: (path?: string) => path || '/project/.swarm/memory.db',
  checkMemoryInitialization: mocks.checkMemoryInitialization,
  initializeMemoryDatabase: mocks.initializeMemoryDatabase,
  storeEntry: mocks.storeEntry,
  searchEntries: vi.fn(),
  listEntries: vi.fn(),
  getEntry: vi.fn(),
  deleteEntry: vi.fn(),
}));

import { memoryCommand } from '../src/commands/memory.js';
import { memoryTools } from '../src/mcp-tools/memory-tools.js';

const storeCommand = memoryCommand.subcommands!.find(c => c.name === 'store')!;
const importTool = memoryTools.find(t => t.name === 'memory_import')!;
const exportTool = memoryTools.find(t => t.name === 'memory_export')!;

const tempDir = mkdtempSync(join(tmpdir(), 'ruflo-ns-3570-'));
const writeImport = (name: string, entries: unknown[]) => {
  const p = join(tempDir, name);
  writeFileSync(p, JSON.stringify({ entries }));
  return p;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkMemoryInitialization.mockResolvedValue({ initialized: true });
  mocks.initializeMemoryDatabase.mockResolvedValue({ success: true });
  mocks.storeEntry.mockResolvedValue({ success: true, id: 'row-1' });
});

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe('namespace path-traversal validation on write paths (#3570)', () => {
  it('memory export already rejects the traversal namespace (the reference behaviour)', async () => {
    await expect(
      exportTool.handler({ outputPath: join(tempDir, 'x.json'), namespace: '../../..' }),
    ).rejects.toThrow(/namespace contains path traversal/);
  });

  it('memory store rejects a namespace containing ../ and writes nothing', async () => {
    const result = await storeCommand.action!({
      args: [],
      flags: { key: 'probe/x', value: 'v', namespace: '../../..' },
    } as any);
    expect(result?.success).toBe(false);
    expect(mocks.storeEntry).not.toHaveBeenCalled();
  });

  it('memory store still accepts an ordinary namespace', async () => {
    const result = await storeCommand.action!({
      args: [],
      flags: { key: 'probe/x', value: 'v', namespace: 'project-a' },
    } as any);
    expect(result?.success).toBe(true);
    expect(mocks.storeEntry).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'project-a' }));
  });

  it('memory import rejects an entry carrying a ../ namespace with the export message and writes nothing', async () => {
    const inputPath = writeImport('bad.json', [
      { key: 'ok', namespace: 'project', value: 'fine' },
      { key: 'K', namespace: '../../..', value: 'v' },
    ]);
    await expect(importTool.handler({ inputPath })).rejects.toThrow(/namespace contains path traversal/);
    expect(mocks.storeEntry).not.toHaveBeenCalled();
  });

  it('memory import still imports entries with ordinary namespaces', async () => {
    const inputPath = writeImport('good.json', [
      { key: 'a', namespace: 'project', value: 'one' },
      { key: 'b', value: 'two' },
    ]);
    const result: any = await importTool.handler({ inputPath });
    expect(result.imported.entries).toBe(2);
    expect(mocks.storeEntry).toHaveBeenCalledTimes(2);
  });
});
