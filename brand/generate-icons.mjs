// One-time icon generation pipeline for Digital Gauges.
//
// Source of truth: brand/icon.svg
// Generated outputs (committed to the repo):
//   brand/icon-512.png              PNG master
//   src/renderer/public/favicon.ico DevTools / renderer favicon
//   build/icon.png                  electron-builder generic icon (512)
//   build/icon.ico                  Windows
//   build/icon.icns                 macOS
//   build/icons/<size>x<size>.png   Linux PNG set
//
// These tools are intentionally NOT listed in package.json. Install them on
// demand before running:
//
//   npm i -D @resvg/resvg-js png-to-ico @fiahfy/icns-convert
//   node brand/generate-icons.mjs
//
// `@resvg/resvg-js` (Rust) rasterizes the SVG at each target size — it has no
// GLib/librsvg dependency, so it works reliably across platforms.
//
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import { convert as icnsConvert } from '@fiahfy/icns-convert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(join(root, 'brand', 'icon.svg'));

const png = (size) =>
  Buffer.from(
    new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng(),
  );

async function ensureDir(p) {
  await mkdir(dirname(p), { recursive: true });
}

async function writePng(size, outPath) {
  await ensureDir(outPath);
  await writeFile(outPath, png(size));
}

// PNG master + electron-builder generic icon
await writePng(512, join(root, 'brand', 'icon-512.png'));
await writePng(512, join(root, 'build', 'icon.png'));

// Linux PNG set
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
  await writePng(size, join(root, 'build', 'icons', `${size}x${size}.png`));
}

// Windows .ico (multi-resolution)
const icoBuf = await pngToIco([16, 24, 32, 48, 64, 128, 256].map((s) => png(s)));
const icoOut = join(root, 'build', 'icon.ico');
await ensureDir(icoOut);
await writeFile(icoOut, icoBuf);

// Renderer favicon — a lean multi-size .ico (small sizes only).
const faviconBuf = await pngToIco([16, 24, 32, 48].map((s) => png(s)));
const faviconOut = join(root, 'src', 'renderer', 'public', 'favicon.ico');
await ensureDir(faviconOut);
await writeFile(faviconOut, faviconBuf);

// macOS .icns
const icnsBuf = await icnsConvert(
  [16, 32, 64, 128, 256, 512, 1024].map((s) => png(s)),
);
const icnsOut = join(root, 'build', 'icon.icns');
await ensureDir(icnsOut);
await writeFile(icnsOut, icnsBuf);

console.log('Generated icons from brand/icon.svg');
