import { mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
const require = createRequire(import.meta.url),
  target = resolve('public/ocr');
await mkdir(target, { recursive: true });
await copyFile(
  join(dirname(require.resolve('tesseract.js/package.json')), 'dist/worker.min.js'),
  join(target, 'worker.min.js'),
);
// The baseline WASM core works on devices without SIMD support as well.
await copyFile(
  join(dirname(require.resolve('tesseract.js-core/package.json')), 'tesseract-core-lstm.wasm.js'),
  join(target, 'tesseract-core-lstm.wasm.js'),
);
const data = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
await copyFile(join(data, '4.0.0_best_int/eng.traineddata.gz'), join(target, 'eng.traineddata.gz'));
await copyFile(
  join(dirname(require.resolve('tesseract.js-core/package.json')), 'LICENSE'),
  join(target, 'TESSERACT-LICENSE'),
);
