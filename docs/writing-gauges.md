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
| `renderToCanvas`  | yes      | Pure canvas render — called every frame at preview *and* at export. |

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
- `leanAngle` (rad)
- `accelX`, `accelY`, `accelZ` (m/s²)
- `gyroX`, `gyroY`, `gyroZ` (rad/s)

Any field may be `undefined` if the active telemetry doesn't include it.

## JSON Schema supported features

The config panel renders inputs for the following property shapes:

- `type: 'string'` → text input
- `type: 'string', format: 'color'` → color picker
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
