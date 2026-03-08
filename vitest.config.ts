import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/api/**', 'src/db/**'],
      exclude: ['src/__tests__/**'],
    },
    pool: 'forks',
  },
});
