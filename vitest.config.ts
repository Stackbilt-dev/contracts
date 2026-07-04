import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@stackbilt/contracts': resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
