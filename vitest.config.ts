import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // entry points that only wire things up; the CLI is tested as a real process (test/mcp and the CI smoke test)
      exclude: ['src/**/*.d.ts', 'src/cli/index.ts', 'src/ui/main.tsx'],
      reporter: ['text-summary', 'text'],
      // a floor, not a goal: CI fails if coverage drops well below today's (lines ≈ 93%)
      thresholds: { lines: 90, statements: 88, functions: 88, branches: 76 },
    },
  },
});
