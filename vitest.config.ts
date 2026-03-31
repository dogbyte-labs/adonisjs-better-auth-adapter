import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/contracts/**/*.spec.ts'],
    globals: false,
    fileParallelism: false,
  },
})
