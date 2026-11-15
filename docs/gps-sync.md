# Camera GPS sync

**Sync → GPS auto-align** reads the camera's own GPS to find the true UTC time
of the video's first frame, then lines the FIT file up against it. It works
even when the camera's clock is wrong, which is common.

Camera GPS is only used for syncing. Gauges still read FIT data only.

## How it stays fast

1. **Probe:** runs when a clip is selected in Sync. It reads only the MP4 index
   (`moov`) and a few telemetry samples, or the 72-byte Insta360 footer, and
   never the video data. It answers "available", "no GPS" (with a reason, such
   as "HERO12 Black has no GPS receiver") or "unsupported".
2. **Extract:** runs only when you click the button. It reads just the GPS
   samples at their known byte offsets, with a byte budget, a 60 s timeout and
   a cancel button.
3. **Offset:** each fixed GPS sample gives an estimate of the video start
   (`utc − videoTime`). The median of those is used. A speed cross-check
   against the FIT file warns if it disagrees by 2 s or more.

The result is stored on the clip (`media.gpsClock`), and the FIT sync anchor
becomes `gps`. Like a manual offset, it's kept fixed until you change it.

## Camera support

| Camera | Status | Notes |
|---|---|---|
| GoPro HERO11, HERO13+ (GPS9) | Supported | Per-sample GPS time. |
| GoPro HERO5–HERO10 (GPS5) | Supported | One GPS timestamp per second, so about ±1–2 s accuracy. The app warns about this. |
| GoPro HERO12, BONES | No GPS | Detected and reported. |
| Insta360 (GPS remote) | **Experimental** | Built from telemetry-parser's documented trailer layout. Only tested on files *without* GPS. The trailer has no video timestamps, so the first GPS fix is assumed to be the start of the recording. |
| DJI Action (`djmd`) | Not yet | Detected and reported as unsupported. |
| CAMM | Not yet | Detected and reported as unsupported. |

## Testing

`npm test` runs `scripts/gps-selftest.ts` against synthetic GoPro and Insta360
files. To also check real camera files, list each path with its expected
status:

```sh
GPS_SAMPLES="/clips/GX010001.MP4:available,/clips/hero12.MP4:no-gps" npx tsx scripts/gps-selftest.ts
```
