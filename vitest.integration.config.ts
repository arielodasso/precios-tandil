import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
