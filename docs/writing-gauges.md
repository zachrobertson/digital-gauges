# Writing user gauges

Digital Gauges loads any `*.gauge.tsx` file dropped into:

- Windows: `%USERPROFILE%\Documents\DigitalGauges\gauges\`
- macOS: `~/Documents/DigitalGauges/gauges/`
- Linux: `~/Documents/DigitalGauges/gauges/`

Each file should default-export a `GaugePlugin` object. The app
transpiles it with esbuild on every save, then hot-reloads it into the
running renderer.

## Minimal example

```tsx
import type { GaugePlugin } from 'digital-gauges';

const plugin: GaugePlugin = {
  id: 'user:cadenceBig',
  name: 'Big Cadence',
  description: 'Single huge cadence number, centered.',
  fields: ['cadence'],
  defaultRect: { x: 0.40, y: 0.74, w: 0.20, h: 0.18 },
  defaultConfig: { color: '#10b981' },
  schema: {
    type: 'object',
    properties: {
      color: { type: 'string', format: 'color', title: 'Number color' },
    },
  },
  renderToCanvas(ctx, frame, config, rect) {
    const rpm = frame?.cadence ?? 0;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = (config as any).color ?? '#10b981';
    ctx.font = `700 ${Math.floor(rect.h * 0.7)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rpm.toFixed(0), rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.textAlign = 'left';
  },
};

export default plugin;
```

## The GaugePlugin interface

| Field             | Required | Description |
|-------------------|----------|-------------|
| `id`              | yes      | Stable, unique. Conventionally prefixed `user:` for user gauges. |
| `name`            | yes      | Shown in the gauge picker. |
| `description`     | no       | Tooltip text. |
| `fields`          | yes      | Telemetry field names the gauge uses (e.g. `'speed'`, `'lat'`). Used to gray out the gauge when the loaded telemetry doesn't include those fields. |
| `defaultRect`     | yes      | Default position/size in relative units (0–1). |
| `defaultConfig`   | yes      | Default config object. |
| `schema`          | yes      | JSON Schema (Draft-7 subset) describing the editable config. The app renders a generic form from it. |
| `renderToCanvas`  | yes      | Pure canvas render — called every frame at preview *and* at export. Also receives `dpr` (device pixel ratio) and `history` (rolling-window telemetry, see below); you can ignore both for simple gauges. |

## Available telemetry fields

Camera + bike-computer data is merged into a single `TelemetryFrame`
passed to your `renderToCanvas`. Available keys:

- `speed` (m/s)
- `power` (W)
- `cadence` (rpm)
- `hr` (bpm)
- `lat`, `lon` (decimal degrees)
- `alt` (m)
- `temp` (°C)
- `grade` (fraction, 0.05 = 5%)
- `distance` (m)
- `distanceToFinish` (m) — derived when a finish-line distance is set in Sync
- `leanAngle` (rad)
- `accelX`, `accelY`, `accelZ` (m/s²)
- `gyroX`, `gyroY`, `gyroZ` (rad/s)

Any field may be `undefined` if the active telemetry doesn't include it.

## Rolling averages (`history`)

`frame` only holds the current sample. For smoothed values, use the sixth
`renderToCanvas` argument instead of buffering frames yourself:

```tsx
renderToCanvas(ctx, frame, config, rect, dpr, history) {
  // Mean of the power samples in the last 3 s of ride time ("3s power").
  const watts = history.average('power', 3000) ?? frame?.power ?? 0;
  // ...
}
```

`history.average(field, windowMs)` averages the samples whose timestamps
fall within the trailing `windowMs` of ride time, ending at the current
frame. It returns `undefined` when no loaded track has the field. Like the
live value, it only changes when a new sample arrives, and it holds the
last value across recording gaps.

Don't keep frame buffers in module or closure state. Render calls are not
sequential: the preview redraws while paused and seeks when you scrub, and
export starts each clip from its first frame. `history` reads straight
from the loaded track, so it gives the same result in all of those cases.

Data Gauge elements expose the same feature in the editor through the
**Smoothing** dropdown on bar, arc, and text elements.

## JSON Schema supported features

The config panel renders inputs for the following property shapes:

- `type: 'string'` → text input
- `type: 'string', format: 'color'` → color picker
- `type: 'string', format: 'font'` → font picker
- `type: 'string', enum: [...]` → select dropdown
- `type: 'number' | 'integer'` with `minimum` / `maximum` / `step` → range slider
- `type: 'boolean'` → toggle

Nested objects and arrays aren't supported yet — keep your config flat.

## Hot reload

Saving the file rebuilds it with esbuild and broadcasts a
`plugins:changed` event. The renderer dynamic-imports the new module
and updates the gauge picker. If your file has a syntax error, the
gauge picker shows it with a red card and the rest of the app keeps
working.

## Performance

`renderToCanvas` is called at the project's preview rate (~60 fps) and
for *every* exported frame. Avoid allocating per call, and cache any
heavy precomputation in module scope.
