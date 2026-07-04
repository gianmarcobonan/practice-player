// Bundles the renderer code with esbuild.
//  - app:    ESM bundle loaded by index.html (UI + transport + wavesurfer)
//  - worklet: IIFE bundle loaded via audioWorklet.addModule (classic script scope)
// Also copies the Rubber Band wasm next to the bundles so it can be fetched at runtime.

import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const outdir = path.resolve('src/renderer/dist');

await mkdir(outdir, { recursive: true });
await copyFile(
  path.resolve('node_modules/rubberband-wasm/dist/rubberband.wasm'),
  path.join(outdir, 'rubberband.wasm')
);

const common = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  target: 'chrome128',
  legalComments: 'none'
};

const appCfg = {
  ...common,
  entryPoints: { app: path.resolve('src/renderer/app/main.js') },
  format: 'esm',
  outdir
};

// AudioWorklet modules run in a classic (non-module) global scope.
const workletCfg = {
  ...common,
  entryPoints: { 'engine-processor': path.resolve('src/renderer/worklet/engine-processor.js') },
  format: 'iife',
  outdir
};

if (watch) {
  const a = await esbuild.context(appCfg);
  const w = await esbuild.context(workletCfg);
  await a.watch();
  await w.watch();
  console.log('esbuild: watching renderer + worklet…');
} else {
  await esbuild.build(appCfg);
  await esbuild.build(workletCfg);
  console.log('esbuild: build complete.');
}
