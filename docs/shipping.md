# Shipping Digital Gauges

This guide covers how to build installable packages and deliver them to
end users once the application is feature-complete. It reflects the
current project setup (Electron + electron-vite + electron-builder) and
notes what still needs to be configured before a production release.

## What you are shipping

Digital Gauges is a **cross-platform desktop application**, not a web
app. Users download and run a native installer or portable package for
their operating system.

| Platform | Build script       | Intended output |
|----------|--------------------|-----------------|
| Windows  | `npm run build:win`  | NSIS installer  |
| macOS    | `npm run build:mac`  | `.dmg`          |
| Linux    | `npm run build:linux`| AppImage        |

Build artifacts land in `./dist/` (gitignored). Compiled source output
from electron-vite goes to `./out/` (also gitignored).

## Build pipeline

The release process is two steps:

1. **Compile** — electron-vite bundles the main process, preload
   script, and React renderer into `./out/`.
2. **Package** — electron-builder wraps `./out/` with the Electron
   runtime and produces platform-specific installers in `./dist/`.

```bash
npm install

# Compile only (useful for CI smoke tests)
npm run build

# Full release build for your current platform
npm run build:win    # on Windows
npm run build:mac    # on macOS
npm run build:linux  # on Linux
```

Each `build:*` script runs `electron-vite build` first, then invokes
`electron-builder` for the target platform.

### Where to build

| Target  | Recommended build host                          |
|---------|-------------------------------------------------|
| Windows | Windows (your current dev machine works)        |
| macOS   | macOS (required for signing and notarization)   |
| Linux   | Linux, or CI (`ubuntu-latest`)                  |

Cross-compiling macOS builds from Windows is not practical for signed
releases. Use a Mac or a CI runner with macOS.

## What is bundled vs. what users install separately

### Bundled in the installer

These ship inside the Electron package and require no user setup:

- Electron runtime and the React UI
- `ffmpeg-static` and `ffprobe-static` (video probe, preview concat,
  export burn-in)
- Garmin / Wahoo FIT parsing (`fit-file-parser`)

### No external dependencies

Telemetry comes exclusively from FIT files. The app does not extract
data from video and has no Python or other external runtime
requirement; end users install nothing beyond the app itself.

## Pre-release checklist

Run through this before tagging a version or uploading installers.

### Build verification

```bash
npm run typecheck
npm run build
npm run build:win   # or build:mac / build:linux on the target OS
```

Confirm `./dist/` contains the expected installer(s).

### Functional smoke test

Test on a **clean machine or VM** (not your dev environment) so you
catch missing dependencies:

1. Install the packaged app from `./dist/`.
2. Load a ride video from any camera.
3. Import a FIT file from a bike computer.
4. Place and configure gauges in the editor.
5. Preview the timeline.
6. Export a burned-in MP4 and verify playback.

### Version and metadata

1. Bump `version` in `package.json` (semver: `MAJOR.MINOR.PATCH`).
2. Update release notes: supported bike computers and known
   limitations.
3. Tag the release: `git tag v0.1.0` (match `package.json` version).

### Legal and attribution

- The project is MIT-licensed (`LICENSE`). Ensure third-party notices
  are included if required by bundled dependencies (FFmpeg, fonts,
  Electron, etc.).

## electron-builder configuration (not yet in repo)

The project has `electron-builder` installed and npm scripts wired up,
but there is **no `build` section in `package.json` yet**. electron-builder
will use defaults, which is enough for local testing but insufficient
for a polished release.

Add a `build` block to `package.json` before your first public release.
Adjust `appId` and paths as needed:

```json
"build": {
  "appId": "com.digitalgauges.app",
  "productName": "Digital Gauges",
  "copyright": "Copyright © ${author}",
  "directories": {
    "output": "dist"
  },
  "files": [
    "out/**/*",
    "package.json"
  ],
  "win": {
    "target": ["nsis"],
    "icon": "build/icon.ico"
  },
  "mac": {
    "target": ["dmg"],
    "icon": "build/icon.icns",
    "category": "public.app-category.video"
  },
  "linux": {
    "target": ["AppImage"],
    "icon": "build/icons",
    "category": "Video"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true
  }
}
```

You will also need application icons:

| Platform | File                          |
|----------|-------------------------------|
| Windows  | `build/icon.ico`              |
| macOS    | `build/icon.icns`             |
| Linux    | `build/icons/` (PNG set)      |

None of these exist in the repository yet.

## Code signing and platform gatekeepers

Unsigned builds install but trigger security warnings. Plan signing
before distributing beyond beta testers.

### Windows

- Obtain a code-signing certificate (EV certificates reduce SmartScreen
  friction; standard certs work but may require reputation building).
- Configure signing in the `build.win` section or via environment
  variables (`CSC_LINK`, `CSC_KEY_PASSWORD`).
- Test the NSIS installer on a VM that has never run the app.

### macOS

- Enroll in the Apple Developer Program.
- Sign the app with a Developer ID Application certificate.
- **Notarize** with Apple's notary service and staple the ticket to
  the `.dmg` or `.app`.
- Set `build.mac.hardenedRuntime`, entitlements, and
  `afterSign`/`notarize` options in electron-builder.

Without notarization, Gatekeeper will block or warn users on current
macOS versions.

### Linux

- AppImages do not require signing, though some distributions support
  GPG-signed release artifacts for power users.

## Delivering to users

### Recommended: GitHub Releases

The repository already points to GitHub. The simplest delivery path:

1. Merge release-ready code to `main`.
2. Tag: `git tag v0.1.0 && git push origin v0.1.0`.
3. Build installers on each target OS (locally or via CI).
4. Create a GitHub Release from the tag.
5. Upload artifacts from `./dist/`:
   - Windows: `Digital Gauges Setup X.Y.Z.exe` (NSIS)
   - macOS: `Digital Gauges-X.Y.Z.dmg`
   - Linux: `Digital Gauges-X.Y.Z.AppImage`
6. Write release notes covering:
   - Supported bike computers (FIT)
   - Minimum OS versions
   - Known issues

### Release notes template

```markdown
## Digital Gauges v0.1.0

Desktop app for overlaying live telemetry gauges on ride videos and
exporting burned-in MP4s.

### Downloads
- **Windows** — `Digital-Gauges-Setup-0.1.0.exe`
- **macOS** — `Digital-Gauges-0.1.0.dmg`
- **Linux** — `Digital-Gauges-0.1.0.AppImage`

### Requirements
- Windows 10+, macOS 12+, or a recent Linux distro with glibc
- A ride video from any camera, plus a FIT file from a bike computer

### Supported telemetry
- Garmin / Wahoo FIT files (speed, power, heart rate, cadence, GPS, …)
```

### Other delivery options (later)

| Approach              | Notes                                              |
|-----------------------|----------------------------------------------------|
| Project website       | Link to GitHub Release assets or a CDN mirror      |
| Auto-update           | Add `electron-updater` + publish to GitHub Releases|
| Package managers      | Possible for Linux (AUR, Flatpak) but extra effort |
| App stores            | Poor fit (FFmpeg, local file access)               |

## CI/CD (not yet configured)

There is no `.github/workflows/` directory today. A typical release
workflow builds all three platforms in parallel and uploads artifacts to
a GitHub Release.

Suggested jobs:

| Job            | Runner            | Command              |
|----------------|-------------------|----------------------|
| `build-windows`| `windows-latest`  | `npm run build:win`  |
| `build-macos`  | `macos-latest`    | `npm run build:mac`  |
| `build-linux`  | `ubuntu-latest`   | `npm run build:linux`|

Store signing secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, Apple API key
for notarization) in GitHub Actions secrets. Trigger on version tags
(`v*`) or manual `workflow_dispatch`.

## Post-release verification

After publishing:

1. Download each installer from the release page (not from `./dist/`).
2. Install on a clean VM per platform.
3. Run the smoke-test flow again.
4. Monitor [GitHub Issues](https://github.com/zachrobertson/digital-gauges/issues)
   for install failures and SmartScreen/Gatekeeper blocks.

## Quick reference

```bash
# Development
npm run dev

# Pre-release checks
npm run typecheck
npm run build

# Platform installers (run on matching OS)
npm run build:win
npm run build:mac
npm run build:linux

# Tag and publish (after builds succeed)
git tag v0.1.0
git push origin v0.1.0
# Upload ./dist/ artifacts to the GitHub Release
```
