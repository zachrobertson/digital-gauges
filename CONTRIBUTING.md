# Contributing to Digital Gauges

Thank you for your interest in contributing. Digital Gauges is a desktop app to
overlay FIT telemetry (speed, power, HR, cadence, GPS, temperature, etc.) on
action-camera video and export a single MP4 with burned-in overlays.

## Before you start

1. Search [existing issues](https://github.com/zachrobertson/digital-gauges/issues)
   to avoid duplicate work.
2. For larger changes (FIT parsing changes, export pipeline changes, sync model
   changes), open an issue first so we can agree on approach before you invest
   significant time.
3. Bug reports should include OS version, app version, camera model, FIT data
   source, and steps to reproduce when possible.

## Development setup

```bash
git clone https://github.com/zachrobertson/digital-gauges.git
cd digital-gauges
npm install
npm run dev
```

Telemetry comes from FIT files only; no Python or camera-specific tools
are required.

## Making changes

- Keep diffs focused — one logical change per pull request when possible.
- Match existing code style: TypeScript strict mode, existing naming, and
  patterns in the file you are editing.
- Prefer extending existing extractors, gauges, and IPC types over parallel
  implementations.
- User gauge plugins are documented in `docs/writing-gauges.md`; changes to
  that API should update the doc in the same PR.

### Project layout (quick reference)

| Area | Path |
|------|------|
| Main process (Node) | `src/main/` |
| FIT parsing + ffprobe | `src/main/extractors/` |
| FFmpeg export | `src/main/export/` |
| React UI | `src/renderer/src/` |
| Built-in gauges | `src/renderer/src/gauges/` |
| Shared IPC/types | `src/shared/` |

### Checks before opening a PR

```bash
npm run typecheck
npm run build
npm test
```

Manually smoke-test the flow you touched (load video, import FIT, place a
gauge, preview, export) when the change affects runtime behavior.

## Pull request guidelines

1. Fork the repo and create a branch from `main`.
2. Write a clear PR description: what changed, why, and how you tested it.
3. Link any related issue (`Fixes #123`).
4. Do not include unrelated formatting or drive-by refactors.

## What we welcome

- Bug fixes and test clips / repro steps for extractor edge cases
- FIT parsing improvements and edge-case handling (with sample files documented)
- Gauge editor and export improvements
- Documentation and README fixes
- Performance improvements with measurable impact

## What needs discussion first

- Breaking changes to `.dgproj` project file format
- Changes to the user gauge plugin API (`digital-gauges` types)
- New runtime dependencies (especially native or Python packages)
- Licensing or telemetry/data-collection behavior

## Code of conduct

Be respectful and constructive. We assume good faith and prioritize clarity
over winning arguments.

## License

By contributing, you agree that your contributions will be licensed under the
MIT License (see `LICENSE`).
