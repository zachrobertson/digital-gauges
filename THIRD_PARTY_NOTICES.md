# Third-Party Notices

Digital Gauges' own source code is licensed under the [MIT License](LICENSE).

Distributed application builds (the Windows, macOS, and Linux installers)
bundle third-party components that carry their own licenses. The notices
below apply to those distributed binaries. They do **not** apply to the
Digital Gauges source code itself, which remains MIT-licensed.

> Source code is MIT-licensed; distributed builds include third-party
> components with separate licenses as listed here.

## Key bundled components

| Component | License | Notes |
|-----------|---------|-------|
| Digital Gauges (this app) | MIT | See [`LICENSE`](LICENSE). |
| FFmpeg (via `ffmpeg-static`) | **GPL-3.0-or-later** | Copyleft. Distributing the binary requires GPL compliance for the combined work. See note below. |
| FFprobe (via `ffprobe-static`) | MIT wrapper around the FFmpeg binary | Treat the bundled FFmpeg binary as FFmpeg for attribution. |
| Electron / Chromium / Node.js | MIT + the Chromium third-party stack | Standard Electron runtime notices apply. |
| React, React DOM | MIT | https://github.com/facebook/react |
| Zustand | MIT | https://github.com/pmndrs/zustand |
| `fit-file-parser` | MIT | https://github.com/jimmykane/fit-file-parser |
| `chokidar`, `esbuild` | MIT | Build/runtime tooling. |
| `@fontsource/*` bundled fonts | OFL-1.1 (SIL Open Font License) | Include the OFL text with redistributed fonts; do not sell the fonts standalone. |
| `@electron-toolkit/*` | MIT | Electron helpers. |

This list covers the major user-facing and copyleft components. The full
dependency tree (and the exact license text for each package) can be
regenerated from `node_modules` with a tool such as
[`license-checker`](https://www.npmjs.com/package/license-checker) when
preparing a release.

## FFmpeg (GPL-3.0-or-later) — important

`ffmpeg-static` ships a prebuilt FFmpeg binary published under
**GPL-3.0-or-later**. Because Digital Gauges distributes this binary inside
its installers, the distributed application is subject to GPL obligations
for the combined work. Before the first public binary release, the project
must either:

1. **Comply with the GPL** — include the GPL-3.0 license text, provide the
   corresponding source for the distributed application, and document how
   users can obtain the FFmpeg source; **or**
2. **Switch to an LGPL FFmpeg build** (or make FFmpeg an optional,
   user-supplied system dependency) to avoid the copyleft obligation for
   the combined work.

The release checklist in [`docs/shipping.md`](docs/shipping.md) tracks the
FFmpeg license verification step.

## Fonts (OFL-1.1)

Bundled fonts from the `@fontsource/*` packages are distributed under the
SIL Open Font License 1.1. When redistributing the fonts, include the OFL
text and reserved font names as required by that license.

---

*This file is an engineering attribution summary, not legal advice. For
commercial or paid distribution, confirm the FFmpeg and bundled-component
strategy with qualified counsel.*
