import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/mobile-access/**/*.test.ts', 'electron/security/**/*.test.ts'],
  },
});
