# Gauge templates

Gauge templates store a styled gauge (or full multi-gauge layout) so you can
reuse the same look across projects. Templates are JSON files with a
`.dgtemplate.json` extension.

## Using templates in the app

1. Open the **Gauges** tab.
2. Under **Saved templates**, click **Import…** and choose a template file.
3. Click the template name to add it to your project.
4. Switch to **Edit** to place the gauge on your video.

You can also save your own templates:

- **Save as template…** — saves the selected gauge’s style and layout.
- **Save layout as preset…** — saves every configured gauge as one layout preset.

Saved templates are stored in:

- Windows: `%USERPROFILE%\Documents\DigitalGauges\templates\`
- macOS: `~/Documents/DigitalGauges/templates/`
- Linux: `~/Documents/DigitalGauges/templates/`

## Example templates

Two starter templates ship with the repo under `docs/examples/`. Import either
file to try them in a project.

### Speedometer bar

[`speed-bar.dgtemplate.json`](examples/speed-bar.dgtemplate.json)

A single horizontal speed bar with default km/h scaling. Good starting point
for one telemetry field and minimal on-screen footprint.

### Race HUD

[`race-hud.dgtemplate.json`](examples/race-hud.dgtemplate.json)

A composite panel with three elements grouped together:

- GPS route mini-map (top left)
- Speed bar (bottom left)
- Power arc dial (right)

The template includes a suggested video placement rect; adjust size and position
in the Edit tab after applying.

## Template file format

```json
{
  "version": 1,
  "id": "unique-id",
  "name": "My template",
  "type": "single",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "gauge": {
    "config": { "layout": { "gaugeRect": {}, "elements": [] } },
    "rect": { "x": 0.04, "y": 0.05, "w": 0.4, "h": 0.2 }
  }
}
```

| Field | Description |
|-------|-------------|
| `type` | `"single"` for one gauge, `"layout"` for multiple gauges in `gauges[]`. |
| `gauge.config.layout` | Composite element tree (bars, arcs, text, maps). |
| `gauge.rect` | Optional normalized placement on the video (0–1). |

When importing, the app assigns a new `id` so the file can coexist with
templates already on disk.
