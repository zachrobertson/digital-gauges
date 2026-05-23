# Digital Gauges

Cross-platform desktop app for adding live, frame-accurate data gauges
(speed, power, heart rate, cadence, GPS map, altitude, lap timer) from
action camera and bike-computer telemetry to ride videos — then burning
the overlay into a finished MP4.

Supports telemetry from:

- **GoPro** (Hero5–Hero13+, GPMF format, pure Node.js extraction)
- **Insta360** (consumer `.insv` + Insta360 Pro CAMM)
- **DJI Action 4/5/6** (protobuf `djmd`)
- **Sony XAVC** (RTMD)
- **CAMM** (Google spec, cases 2/3/5/6)
- **Garmin / Wahoo bike computers** (FIT files)

## Tech Stack

- Electron 31 + electron-vite (Vite renderer, Node main)
- React 18 + TypeScript + Tailwind CSS
- Zustand for state
- `gpmf-extract` + `gopro-telemetry` for GoPro (Node)
- `telemetry-parser` Python subprocess for Insta360 / DJI / Sony
- `fit-file-parser` for FIT
- `ffmpeg-static` + `fluent-ffmpeg` for export

## Development

```bash
npm install
npm run dev
```

`npm run dev` launches the Electron app with hot-reload on the renderer.

## Building

```bash
npm run build           # creates ./out
npm run build:win       # Windows installer (NSIS)
npm run build:mac       # macOS DMG
npm run build:linux     # AppImage
```

## Python Dependencies (Insta360 / DJI / Sony)

Non-GoPro brands rely on the `telemetry-parser` Python library.
Install once:

```bash
pip install telemetry-parser
```

The app will detect a missing Python interpreter or library and surface
an installation prompt rather than crashing.

## Project Layout

```
src/
├── main/                  Electron main process
│   ├── extractors/        Per-brand telemetry extractors
│   ├── ipc/               IPC channel handlers
│   ├── export/            FFmpeg burn-in pipeline
│   └── plugins/           User gauge loader (esbuild)
├── preload/               Bridge between main and renderer
├── renderer/src/          React UI
│   ├── components/        Player, editor, timeline
│   ├── gauges/            Built-in gauge React + canvas
│   └── store/             Zustand slices
└── shared/types/          IPC contract types
```

See `docs/writing-gauges.md` for the user-gauge plugin format.
