// Build洛谷 Markdown → PDF userscript: embed KaTeX (css/js/fonts) as a gzip+base64 blob.
// usage: node build.mjs <src.users.js> <dist.users.js>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = import.meta.dirname;
const assets = path.join(dir, 'assets');
const srcFile = process.argv[2];
const outFile = process.argv[3];
if (!srcFile || !outFile) {
  console.error('usage: node build.mjs <src.users.js> <dist.users.js>');
  process.exit(1);
}

const css = fs.readFileSync(path.join(assets, 'katex.min.css'), 'utf8');
const js = fs.readFileSync(path.join(assets, 'katex.min.js'), 'utf8');
const auto = fs.readFileSync(path.join(assets, 'auto-render.min.js'), 'utf8');

const version = /content:"(\d+\.\d+\.\d+)"/.exec(css)[1];
const names = [...new Set(
  [...css.matchAll(/url\((['"]?)(?:\.\/)?fonts\/([^)'"]+)\1\)/g)].map((m) => m[2])
)].filter((n) => /\.woff2$/i.test(n));

const fonts = {};
for (const n of names) fonts[n] = fs.readFileSync(path.join(assets, 'fonts', n)).toString('base64');

const payload = JSON.stringify({ version, css, js, auto, fonts });
const gz = zlib.gzipSync(Buffer.from(payload, 'utf8'), { level: 9 });
const b64 = gz.toString('base64');

let src = fs.readFileSync(srcFile, 'utf8').replace(/^\uFEFF/, '');
if (!src.includes('__KATEX_EMBEDDED_GZIP_B64__')) {
  throw new Error('placeholder __KATEX_EMBEDDED_GZIP_B64__ not found in ' + srcFile);
}
src = src.replace('__KATEX_EMBEDDED_GZIP_B64__', () => b64);
fs.writeFileSync(outFile, src, 'utf8');

console.log(
  `built ${path.basename(outFile)}: ${(src.length / 1024).toFixed(0)}KB ` +
  `(KaTeX ${version}, ${names.length} fonts, payload ${(payload.length / 1024).toFixed(0)}KB -> gzip ${(gz.length / 1024).toFixed(0)}KB)`
);
