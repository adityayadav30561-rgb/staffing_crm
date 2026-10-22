import { defineConfig } from 'tsup';

// Bundles the API (and the workspace's shared package) into dist/; npm deps stay external.
export default defineConfig({
  entry: { main: 'src/main.ts', seed: 'src/db/seed.ts' },
  format: 'esm',
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: ['@crm/shared'],
});
