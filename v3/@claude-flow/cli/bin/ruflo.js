#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === '--version' || args[0] === '-V')) {
  const dir = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(dir, '..', 'package.json'), 'utf8'));
  console.log(`ruflo v${pkg.version} (ko)`);
  process.exit(0);
}

await import('./cli.js');
