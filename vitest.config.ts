import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/*/tests/**/*.test.ts',
      'packages/*/*/tests/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'apps/worker/src/**/*.test.ts',
      'apps/api/src/**/*.test.ts',
      'tests/e2e/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', 'tests/integration/**', 'tests/e2e/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: [
        'packages/normalizer/src/**/*.ts',
        'packages/scraper-core/src/validation/**/*.ts',
        'packages/shared/src/money.ts',
        'packages/shared/src/time.ts',
        'packages/shared/src/price-math/**/*.ts',
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
