import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { backupMemoryDb, restoreMemoryDbFromBackup } from '../src/services/memory-backup.js';

let dir: string;
const start = 1_700_000_000_000;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'memory-backup-isolation-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
function seed(name: string) {
  const dbPath = join(dir, name);
  const db = new Database(dbPath);
  db.exec('CREATE TABLE memory_entries (content TEXT)');
  db.prepare('INSERT INTO memory_entries VALUES (?)').run(name);
  db.close();
  return dbPath;
}
function content(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare('SELECT content FROM memory_entries').get(); }
  finally { db.close(); }
}

describe('backup identity across sibling memory stores', () => {
  it('does not overwrite a different store snapshot at the same timestamp', async () => {
    const primary = seed('memory.db');
    const mirror = seed('agentdb-memory.db');
    const a = await backupMemoryDb({ dbPath: primary, timestamp: start });
    const b = await backupMemoryDb({ dbPath: mirror, timestamp: start });
    expect(a.backedUp).toBe(true);
    expect(b.backedUp).toBe(true);
    expect(a.path).not.toBe(b.path);
    expect(content(a.path!)).toEqual({ content: 'memory.db' });
    expect(content(b.path!)).toEqual({ content: 'agentdb-memory.db' });
  });

  it('rotates only snapshots belonging to the selected store', async () => {
    const primary = seed('memory.db');
    const mirror = seed('agentdb-memory.db');
    const a = await backupMemoryDb({ dbPath: primary, timestamp: start, keep: 1 });
    const b = await backupMemoryDb({ dbPath: mirror, timestamp: start + 1000, keep: 1 });
    const c = await backupMemoryDb({ dbPath: mirror, timestamp: start + 2000, keep: 1 });
    expect(existsSync(a.path!)).toBe(true);
    expect(existsSync(b.path!)).toBe(false);
    expect(existsSync(c.path!)).toBe(true);
    expect(c.rotatedAway).toHaveLength(1);
  });

  it.each(['memory.db', 'agentdb-memory.db'])('restores only %s snapshots even when another store is newer', async (name) => {
    const primary = seed(name);
    const other = seed(name === 'memory.db' ? 'agentdb-memory.db' : 'memory.db');
    const a = await backupMemoryDb({ dbPath: primary, timestamp: start });
    await backupMemoryDb({ dbPath: other, timestamp: start + 1000 });
    writeFileSync(primary, 'corrupt source');
    const restored = await restoreMemoryDbFromBackup(primary);
    expect(restored.restored).toBe(true);
    expect(restored.from).toBe(a.path);
    expect(content(primary)).toEqual({ content: name });
  });
});
