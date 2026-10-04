import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // mod.test.ts runs under `claude plugin test` (claude-code/testing), not vitest.
    exclude: ['tests/mod.test.ts', 'node_modules/**'],
    environment: 'node',
    globals: false,
  },
});
