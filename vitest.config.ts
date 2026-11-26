import { defineConfig } from 'vitest/config';
// tests/links.test.ts usa el runner de node (node --test), no vitest.
export default defineConfig({ test: { environment: 'node', include: ['tests/**/*.test.ts'], exclude: ['tests/links.test.ts', 'node_modules/**', '.claude/**'] } });
