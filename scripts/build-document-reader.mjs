import { build } from 'esbuild';
import { copyFile, cp, mkdir } from 'node:fs/promises';

await mkdir('dist/document-reader',{recursive:true});
await Promise.all([
  build({entryPoints:['src/document-reader.js'],bundle:true,minify:true,platform:'browser',format:'esm',
    target:'es2022',outfile:'dist/document-reader/index.js'}),
  copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','dist/document-reader/pdf.worker.min.mjs'),
  copyFile('node_modules/tesseract.js/dist/worker.min.js','dist/document-reader/ocr.worker.min.js'),
  cp('node_modules/pdfjs-dist/wasm','dist/document-reader/pdf-wasm',{recursive:true}),
]);
