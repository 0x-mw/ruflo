// typescript / yaml 해석기 (계획 §4.3). 새 의존성 없이 CLI node_modules 의 것을 쓴다.
// 해석 순서: RUFLO_I18N_TS > $REPO/v3/@claude-flow/cli/node_modules > ~/.cache/ruflo-ko-build/... > $REPO/node_modules
// 어디에도 없으면 안내를 출력하고 exit 2.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const require_ = createRequire(import.meta.url);

function nodeModulesCandidates() {
  const list = [];
  const env = process.env.RUFLO_I18N_TS;
  if (env) {
    list.push(env);
    // typescript 패키지 디렉터리를 직접 준 경우 그 위가 node_modules
    list.push(path.dirname(env));
  }
  list.push(path.join(REPO, 'v3/@claude-flow/cli/node_modules'));
  list.push(path.join(os.homedir(), '.cache/ruflo-ko-build/v3/@claude-flow/cli/node_modules'));
  list.push(path.join(REPO, 'node_modules'));
  return list;
}

/** pkg 가 들어 있는 node_modules 디렉터리를 찾는다. 없으면 null. */
export function findNodeModules(pkg) {
  for (const dir of nodeModulesCandidates()) {
    try {
      if (fs.existsSync(path.join(dir, pkg, 'package.json'))) return dir;
    } catch { /* 다음 후보 */ }
  }
  return null;
}

function fail(pkg) {
  process.stderr.write(
    `[i18n] '${pkg}' 패키지를 찾지 못했습니다. 다음 순서로 찾았습니다:\n` +
      nodeModulesCandidates().map((d) => `  - ${d}`).join('\n') +
      `\nRUFLO_I18N_TS=<node_modules 경로> 로 지정하거나, ~/.cache/ruflo-ko-build 에서 pnpm install 을 먼저 하세요.\n`,
  );
  process.exit(2);
}

let tsCache = null;
let yamlCache = null;

export function loadTs() {
  if (tsCache) return tsCache;
  const dir = findNodeModules('typescript');
  if (!dir) fail('typescript');
  tsCache = require_(path.join(dir, 'typescript'));
  return tsCache;
}

export function loadYaml() {
  if (yamlCache) return yamlCache;
  const dir = findNodeModules('yaml');
  if (!dir) fail('yaml');
  yamlCache = require_(path.join(dir, 'yaml'));
  return yamlCache;
}
