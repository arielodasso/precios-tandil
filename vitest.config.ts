import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts', 'packages/shared/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: [
        'packages/normalizer/src/**/*.ts',
        'packages/scraper-core/src/validation/**/*.ts',
        'packages/shared/src/money.ts',
        'packages/shared/src/time.ts',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 85,
        branches: 75,
      },
    },
  },
});
