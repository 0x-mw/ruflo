// 샤드 읽기·쓰기·병합 (계획 §4.3 "샤드 형식과 병합"). 같은 입력이면 같은 바이트를 낸다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { REPO } from './ts-resolve.mjs';

export const KO_DIR = path.join(REPO, 'i18n/ko');
export const SHARD_SCHEMA = 'ruflo-i18n-shard/1';

/** 샤드 하나의 최대 항목 수. 큰 소스는 이 크기로 나눠 번역 배치(400~600)에 담을 수 있게 한다. */
export const MAX_SHARD = 500;

export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function stableJson(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** dir 아래 모든 .json 파일(재귀)의 KO_DIR 기준 상대 경로, 정렬됨. 디렉터리가 없으면 []. */
export function listJson(dirRel) {
  const out = [];
  const walk = (abs) => {
    let names;
    try {
      names = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      const p = path.join(abs, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.json')) out.push(path.relative(KO_DIR, p).split(path.sep).join('/'));
    }
  };
  walk(path.join(KO_DIR, dirRel));
  return out.sort(cmp);
}

/** 기존 샤드들에서 키 → ko(번역 | null) 맵. entries 가 obsolete 보다 우선한다. */
export function koMapOf(shards) {
  const map = new Map();
  for (const s of shards) {
    if (!s) continue;
    for (const e of s.obsolete || []) if (e && typeof e.key === 'string' && !map.has(e.key)) map.set(e.key, e.ko);
  }
  for (const s of shards) {
    if (!s) continue;
    for (const e of s.entries || []) if (e && typeof e.key === 'string') map.set(e.key, e.ko);
  }
  return map;
}

/** 새 샤드 객체. obsolete 는 기존 샤드에서 번역이 있었는데 단위에서 사라진 키들이다. */
export function makeShard({ target, source, entries, oldShard, unitKeys }) {
  const obsMap = new Map();
  if (oldShard) {
    for (const e of [...(oldShard.obsolete || []), ...(oldShard.entries || [])]) {
      if (!e || typeof e.key !== 'string') continue;
      if (unitKeys.has(e.key)) continue;
      if (typeof e.ko !== 'string' || e.ko === '') continue;
      obsMap.set(e.key, { key: e.key, ko: e.ko, kind: e.kind || (/\{\d+\}/.test(e.key) ? 'template' : 'text') });
    }
  }
  const obsolete = [...obsMap.values()].sort((a, b) => cmp(a.key, b.key));
  return { schema: SHARD_SCHEMA, target, source, entries, obsolete };
}

/** entries 를 균등한 크기의 조각으로 나눈다(≤ MAX_SHARD). 조각이 하나면 [entries]. */
export function chunkEntries(entries, max = MAX_SHARD) {
  if (entries.length <= max) return [entries];
  const parts = Math.ceil(entries.length / max);
  const size = Math.ceil(entries.length / parts);
  const out = [];
  for (let i = 0; i < entries.length; i += size) out.push(entries.slice(i, i + size));
  return out;
}

/** 파일 이름에 쓸 슬러그: 경로의 `/` 를 `__` 로. */
export const slugOf = (p) => p.replace(/\.[^./]+$/, '').split('/').join('__');

export function md5OfTree(dirAbs) {
  const files = [];
  const walk = (abs) => {
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, d.name);
      if (d.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  if (fs.existsSync(dirAbs)) walk(dirAbs);
  files.sort();
  const h = crypto.createHash('md5');
  for (const f of files) {
    h.update(path.relative(dirAbs, f));
    h.update(crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex'));
  }
  return h.digest('hex');
}

/**
 * 파일 쓰기 도우미. dryRun(--check)이면 쓰지 않고 차이만 모은다.
 */
export class Writer {
  constructor({ dryRun = false } = {}) {
    this.dryRun = dryRun;
    this.changed = [];
    this.written = new Set(); // KO_DIR 기준 상대 경로
  }

  write(rel, text) {
    this.written.add(rel);
    const abs = path.join(KO_DIR, rel);
    let cur = null;
    try {
      cur = fs.readFileSync(abs, 'utf8');
    } catch { /* 새 파일 */ }
    if (cur === text) return false;
    this.changed.push(rel);
    if (!this.dryRun) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
    }
    return true;
  }

  remove(rel) {
    this.changed.push(`-${rel}`);
    if (!this.dryRun) {
      try {
        fs.unlinkSync(path.join(KO_DIR, rel));
      } catch { /* 이미 없음 */ }
    }
  }

  /** dirRel 아래 json 중 이번에 쓰지 않은 것을 지운다(keep 에 든 것은 제외). */
  prune(dirRel, keep = []) {
    for (const rel of listJson(dirRel)) {
      if (this.written.has(rel) || keep.includes(rel)) continue;
      this.remove(rel);
    }
  }
}
