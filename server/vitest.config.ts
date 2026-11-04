import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/helpers/globalSetup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: { NODE_ENV: 'test', SEED_ON_START: 'false' },
  },
});
