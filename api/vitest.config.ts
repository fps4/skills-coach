import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Integration tests talk to a real MongoDB and self-skip when it is unreachable
    // (see tests/integration/helpers.ts), so the same command works with Docker down.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
