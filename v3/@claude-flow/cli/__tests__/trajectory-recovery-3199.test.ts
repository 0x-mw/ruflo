import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const durable = new Map<string, string>();
const storeEntry = vi.fn(async ({ key, value, upsert }: { key: string; value: string; upsert?: boolean }) => {
  if (durable.has(key) && !upsert) return { success: false, id: '', error: 'duplicate key' };
  durable.set(key, value);
  return { success: true, id: key };
});
const getEntry = vi.fn(async ({ key }: { key: string }) => ({ success: true, found: durable.has(key), entry: { content: durable.get(key) } }));
const deleteEntry = vi.fn(async ({ key }: { key: string }) => ({ success: true, deleted: durable.delete(key) }));
vi.mock('../src/memory/memory-initializer.js', () => ({ storeEntry, getEntry, deleteEntry }));
vi.mock('../src/memory/sona-optimizer.js', () => ({ getSONAOptimizer: async () => null }));
vi.mock('../src/memory/ewc-consolidation.js', () => ({ getEWCConsolidator: async () => null }));
vi.mock('../src/memory/intelligence.js', () => ({ runBackgroundLearning: async () => {} }));
vi.mock('../src/memory/graph-edge-writer.js', () => ({ insertGraphEdge: async () => {} }));
vi.mock('../src/ruvector/trajectory-tree.js', () => ({ getTrajectoryTree: () => ({ openTrajectory() {}, appendStep() {}, closeTrajectory() {} }) }));

const fresh = async () => { vi.resetModules(); return import('../src/mcp-tools/hooks-tools.js'); };
beforeEach(() => { durable.clear(); storeEntry.mockClear(); getEntry.mockClear(); deleteEntry.mockClear(); });

describe('pending trajectory recovery (#3199)', () => {
  it('resumes steps and completion after module state is lost twice', async () => {
    const a = await fresh();
    const started = await a.hooksTrajectoryStart.handler({ task: 'resume work', agent: 'coder' }) as any;
    const b = await fresh();
    expect(await b.hooksTrajectoryStep.handler({ trajectoryId: started.trajectoryId, action: 'saved step', quality: 0.7 })).toMatchObject({ recorded: true, totalSteps: 1 });
    const c = await fresh();
    expect(await c.hooksTrajectoryEnd.handler({ trajectoryId: started.trajectoryId, success: true })).toMatchObject({ persisted: true, trajectory: { totalSteps: 1 } });
    const completed = JSON.parse(durable.get(`trajectory-${started.trajectoryId}`)!);
    expect(completed.steps[0].action).toBe('saved step');
    expect(durable.has(`trajectory-pending-${started.trajectoryId}`)).toBe(false);
    const d = await fresh();
    expect(await d.hooksTrajectoryEnd.handler({ trajectoryId: started.trajectoryId })).toMatchObject({ persisted: false });
  });

  it('retains the pending trajectory when final persistence fails', async () => {
    const a = await fresh();
    const started = await a.hooksTrajectoryStart.handler({ task: 'retry work' }) as any;
    storeEntry.mockResolvedValueOnce({ success: false, id: '', error: 'disk full' } as any);
    expect(await a.hooksTrajectoryEnd.handler({ trajectoryId: started.trajectoryId })).toMatchObject({ persisted: false });
    expect(deleteEntry).not.toHaveBeenCalled();
    const b = await fresh();
    expect(await b.hooksTrajectoryEnd.handler({ trajectoryId: started.trajectoryId })).toMatchObject({ persisted: true });
  });

  it('keeps in-flight trajectories when learned state is reset', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-reset-'));
    const previous = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = root;
    try {
      const a = await fresh();
      storeEntry.mockResolvedValueOnce({ success: false, id: '' });
      const started = await a.hooksTrajectoryStart.handler({ task: 'in flight' }) as any;
      expect(await a.hooksIntelligenceReset.handler({})).toMatchObject({ cleared: { trajectories: 0 } });
      expect(await a.hooksTrajectoryStep.handler({ trajectoryId: started.trajectoryId, action: 'after reset' })).toMatchObject({ recorded: true });
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_FLOW_CWD; else process.env.CLAUDE_FLOW_CWD = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not replay a completed trajectory when pending cleanup fails', async () => {
    const a = await fresh();
    const started = await a.hooksTrajectoryStart.handler({ task: 'finish once' }) as any;
    deleteEntry.mockRejectedValueOnce(new Error('cleanup unavailable'));
    expect(await a.hooksTrajectoryEnd.handler({ trajectoryId: started.trajectoryId })).toMatchObject({ persisted: true });
    storeEntry.mockClear();
    const b = await fresh();
    expect(await b.hooksTrajectoryEnd.handler({ trajectoryId: started.trajectoryId })).toMatchObject({ persisted: false });
    expect(storeEntry).not.toHaveBeenCalled();
  });

  it.each(['{', JSON.stringify({ id: 'other', task: 'bad', agent: 'coder', steps: [], startedAt: new Date().toISOString() })])('rejects corrupt or mismatched pending records', async (value) => {
    durable.set('trajectory-pending-traj-missing', value);
    const a = await fresh();
    expect(await a.hooksTrajectoryEnd.handler({ trajectoryId: 'traj-missing' })).toMatchObject({ persisted: false });
    expect(storeEntry).not.toHaveBeenCalled();
  });
});
