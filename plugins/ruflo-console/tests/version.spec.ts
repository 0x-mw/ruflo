/**
 * The version the console shows is the plugin's manifest version. Run with
 *   npx vitest run plugins/ruflo-console/tests/version.spec.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CONSOLE_VERSION } from '../hooks/version'

describe('console version', () => {
  it('matches the plugin manifest, so the header shows the build that is running', () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url)), 'utf8')) as { version: string }

    expect(CONSOLE_VERSION).toBe(manifest.version)
  })
})
