import { defineConfig } from 'tsup';

// Bundle the ExitProbe SDK into the output so the package installs standalone
// from a tarball (the SDK is a devDependency only).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  noExternal: ['exitprobe'],
  banner: { js: '#!/usr/bin/env node' },
});
