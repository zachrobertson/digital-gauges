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
- FIT telemetry parsing (`fit-file-parser`)

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
npm test
npm run build:win   # or build:mac / build:linux on the target OS
```

Confirm `./dist/` contains the expected installer(s).

### Functional smoke test

Test on a **clean machine or VM** (not your dev environment) so you
catch missing dependencies:

1. Install the packaged app from `./dist/`.
2. Load action-camera video from any camera.
3. Import a FIT data file.
4. Place and configure gauges in the editor.
5. Preview the timeline.
6. Export a burned-in MP4 and verify playback.

### Version and metadata

1. Open a **release PR** targeting `main`. Mark it as a release using
   **one** of:
   - branch name `release/*` (e.g. `release/1.0.0`)
   - the `release` label on the PR
   - `[release]` in the PR title
2. Bump `version` in `package.json` (semver: `MAJOR.MINOR.PATCH`) to a
   value **strictly greater** than `main`, then run `npm install` so
   `package-lock.json` stays in sync.
3. CI runs **Release version check** on the PR and fails if the version
   was not bumped or the lockfile does not match.
4. Update release notes: supported FIT data sources and known
   limitations.
5. Merge the release PR to `main`, then tag: `git tag v1.0.0` (must
   match `package.json` version).

### Legal and attribution

- The project source is MIT-licensed (`LICENSE`). Distributed builds bundle
  third-party components with separate licenses — keep
  `THIRD_PARTY_NOTICES.md` accurate for the shipped version.
- [ ] **Verify the bundled FFmpeg license before the first public binary
  release.** The `ffmpeg-static` binary is published as
  **GPL-3.0-or-later**, which imposes copyleft obligations on the
  distributed app. Run the bundled binary and record its license line:

  ```bash
  node -e "console.log(require('ffmpeg-static'))"   # path to the binary
  "<printed path>" -version                          # check the config line
  ```

  Look for `--enable-gpl` / the license in the banner. If GPL, either comply
  (include GPL text, offer corresponding source, document how to obtain the
  FFmpeg source) or migrate to an LGPL FFmpeg build / optional system
  FFmpeg. See `THIRD_PARTY_NOTICES.md` for details.

## electron-builder configuration

The `build` section in `package.json` is already configured with app ID,
output directory, platform targets, and `asarUnpack` entries for
`ffmpeg-static` and `ffprobe-static` (native binaries must not stay
inside the asar archive).

Application icons live under `build/` (generated from `brand/icon.svg`
via `node brand/generate-icons.mjs`):

| Platform | File                          |
|----------|-------------------------------|
| Windows  | `build/icon.ico`              |
| macOS    | `build/icon.icns`             |
| Linux    | `build/icons/` (PNG set)      |

Linux builds also set `desktopName` in `package.json` so
`StartupWMClass` matches Electron's `WM_CLASS`, and ship
`build/icon.png` via `extraResources` for the window/taskbar icon.

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

1. Open a release PR to `main` (branch `release/*`, label `release`, or
   title containing `[release]`).
2. Bump `version` in `package.json` and `package-lock.json`; wait for CI
   **Release version check** to pass.
3. Merge to `main`.
4. Tag: `git tag v1.0.0 && git push origin v1.0.0` (tag must match
   `package.json`).
5. CI builds installers on each target OS and publishes a GitHub Release
   from the tag.
6. Verify artifacts on the release page:
   - Windows: `Digital Gauges Setup X.Y.Z.exe` (NSIS)
   - macOS: `Digital Gauges-X.Y.Z.dmg`
   - Linux: `Digital Gauges-X.Y.Z.AppImage`
7. Write or review release notes covering:
   - Supported FIT data sources
   - Minimum OS versions
   - Known issues (include the Linux AppImage notes below when shipping
     Linux builds)

### Linux AppImage (end-user setup)

An AppImage is a portable single file — no installer. Include the
following in release notes (or link to this section) so Linux users
know how to run the app.

1. Download `Digital-Gauges-X.Y.Z.AppImage`.
2. Make it executable once: `chmod +x Digital-Gauges-*.AppImage`.
3. Run from a terminal (`./Digital-Gauges-*.AppImage`) or integrate
   into the application menu with
   [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher)
   (recommended on KDE).

**Requirements:** 64-bit Linux with glibc (Debian 12+, Fedora, Ubuntu,
etc.). On Debian, install `libfuse2t64` if the file will not mount.
Alternatively: `./Digital-Gauges-*.AppImage --appimage-extract-and-run`.

**Known issues:** Wayland sessions may fail to launch the app; logging
in to an X11 session (e.g. Plasma on X11) or running with
`--disable-gpu --disable-gpu-sandbox` may be required if the window
never appears. The AppImage adds `--no-sandbox` automatically when user
namespaces are unavailable; GPU flags are not added by default — users
who need them can add those flags to the `.desktop` `Exec=` line or a
wrapper script after AppImageLauncher integration.

App preferences, projects, and gauge data are stored under the normal
Electron user-data directory (`~/.config/`), not inside the AppImage.

### Release notes template

```markdown
## Digital Gauges v0.1.0

Overlay FIT telemetry on action video and export a burned-in MP4.

### Downloads
- **Windows** — `Digital-Gauges-Setup-0.1.0.exe`
- **macOS** — `Digital-Gauges-0.1.0.dmg`
- **Linux** — `Digital-Gauges-0.1.0.AppImage`

### Requirements
- Windows 10+, macOS 12+, or a recent Linux distro with glibc
- Action-camera video from any camera, plus a FIT data file

### Linux (AppImage)

1. Download `Digital-Gauges-X.Y.Z.AppImage`
2. `chmod +x Digital-Gauges-*.AppImage`
3. Run from terminal, or integrate with [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) for menu/dock support

**Requirements:** 64-bit Linux with glibc (Debian 12+, Fedora, Ubuntu, etc.).
Install `libfuse2t64` on Debian if the file won't start.

**Known issues:** Wayland sessions may not launch the app; use Plasma (X11) or run with
`--disable-gpu --disable-gpu-sandbox` if the window never appears.

### Supported telemetry
- FIT files (speed, power, heart rate, cadence, GPS, temperature, …)
```

### Other delivery options (later)

| Approach              | Notes                                              |
|-----------------------|----------------------------------------------------|
| Project website       | Link to GitHub Release assets or a CDN mirror      |
| Auto-update           | Add `electron-updater` + publish to GitHub Releases|
| Package managers      | Possible for Linux (AUR, Flatpak) but extra effort |
| App stores            | Poor fit (FFmpeg, local file access)               |

## CI/CD

`.github/workflows/ci.yml` runs on pushes and PRs to `main` and
`develop`, and on version tags (`v*`). The pipeline:

1. **release-version** (PRs to `main` only) — when a PR is marked as a
   release (branch `release/*`, label `release`, or title containing
   `[release]`), verifies that `package.json` version is strictly greater
   than `main` and that `package-lock.json` matches. Non-release PRs skip
   this job.
2. **validate** — `npm run typecheck`, `npm run build`, `npm test`
3. **build** — matrix of `build:win`, `build:mac`, and `build:linux`
   on matching runners (unsigned; `CSC_IDENTITY_AUTO_DISCOVERY: false`)
4. **release** — on `v*` tags, uploads installer artifacts to a GitHub
   Release via `softprops/action-gh-release`

For signed releases, store signing secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`,
Apple API key for notarization) in GitHub Actions secrets and adjust the
workflow to enable signing.

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
npm test

# Platform installers (run on matching OS)
npm run build:win
npm run build:mac
npm run build:linux

# Release PR to main (release/* branch, release label, or [release] title)
# Bump package.json + npm install, merge when CI passes

# Tag and publish (on main, after merge)
git tag v1.0.0
git push origin v1.0.0
# CI uploads ./dist/ artifacts to the GitHub Release
```
