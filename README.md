# Digital Gauges

Cross-platform desktop app for adding live, frame-accurate data gauges
(speed, power, heart rate, cadence, GPS map, altitude, lap timer) from
bike-computer telemetry to ride videos — then burning the overlay into a
finished MP4.

You bring two things:

- **A ride video** from any action camera (GoPro, Insta360, DJI, Sony,
  etc.) — used for picture and timing only.
- **A FIT file** from a **Garmin / Wahoo bike computer** — the source of
  all gauge data (speed, power, heart rate, cadence, GPS, altitude, …).

No camera-specific software or telemetry extraction is required.

## Tech Stack

- Electron 31 + electron-vite (Vite renderer, Node main)
- React 18 + TypeScript + Tailwind CSS
- Zustand for state
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

## Project Layout

```
src/
├── main/                  Electron main process
│   ├── extractors/        FIT parsing + ffprobe helpers
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
