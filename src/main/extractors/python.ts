import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Helper for invoking the `telemetry-parser` Python library
 * (https://pypi.org/project/telemetry-parser/) as a subprocess.
 *
 * Why a subprocess: telemetry-parser has no Node.js binding; the Rust
 * crate exists but adds native build complexity. A 50-line Python
 * shim is the simplest path.
 *
 * Lookup order for the Python interpreter:
 *   1. process.env.DIGITAL_GAUGES_PYTHON
 *   2. `python3` on PATH
 *   3. `python` on PATH
 */

let pythonBinaryCache: string | null = null;

export class PythonNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonNotAvailableError';
  }
}

async function tryPython(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ['-c', 'import telemetry_parser; print("ok")']);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0 && out.trim() === 'ok'));
  });
}

export async function resolvePython(): Promise<string> {
  if (pythonBinaryCache) return pythonBinaryCache;

  const candidates: string[] = [];
  if (process.env.DIGITAL_GAUGES_PYTHON) candidates.push(process.env.DIGITAL_GAUGES_PYTHON);
  candidates.push('python3', 'python');

  for (const c of candidates) {
    if (await tryPython(c)) {
      pythonBinaryCache = c;
      return c;
    }
  }

  throw new PythonNotAvailableError(
    'Python interpreter with the telemetry-parser library was not found. ' +
    'Install Python 3.10+ and run `pip install telemetry-parser`, or set ' +
    'DIGITAL_GAUGES_PYTHON to a working interpreter.',
  );
}

/**
 * Embedded Python shim that drives telemetry-parser and emits a single
 * JSON object on stdout in our normalized shape:
 *
 * {
 *   "brand": "DJI",
 *   "model": "Osmo Action 4",
 *   "start_time_unix_ms": 1715000000000,
 *   "samples": [
 *     { "t_ms": 0, "lat": 47.6, "lon": -122.3, "alt": 30, "speed": 8.1,
 *       "accel": [0,0,-9.8], "gyro": [0,0,0] },
 *     ...
 *   ],
 *   "warnings": ["..."]
 * }
 *
 * Written to a temp file so the python -c arg quoting stays safe on Win.
 */
const PYTHON_SHIM = `
import sys
import json
import os
import math

try:
    import telemetry_parser as tp
except Exception as e:
    print(json.dumps({"error": f"telemetry_parser import failed: {e}"}))
    sys.exit(0)


def _flatten_imu(samples_iter, axis_key):
    out = {}
    for s in samples_iter:
        t = s.get("timestamp_ms")
        if t is None:
            continue
        out.setdefault(int(t), {})[axis_key + "X"] = s.get("x")
        out[int(t)][axis_key + "Y"] = s.get("y")
        out[int(t)][axis_key + "Z"] = s.get("z")
    return out


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: python shim.py <video_path>"}))
        return
    path = sys.argv[1]

    if not os.path.exists(path):
        print(json.dumps({"error": f"file not found: {path}"}))
        return

    try:
        parser = tp.Parser(path)
    except Exception as e:
        print(json.dumps({"error": f"parser init failed: {e}"}))
        return

    brand = getattr(parser, "camera", None) or ""
    model = getattr(parser, "model", None) or ""

    warnings = []

    try:
        norm = parser.normalized_imu()
    except Exception as e:
        warnings.append(f"normalized_imu failed: {e}")
        norm = []

    accel_rows = []
    gyro_rows = []
    if isinstance(norm, list):
        for n in norm:
            t = n.get("timestamp_ms")
            if t is None:
                continue
            if "accl" in n and n["accl"]:
                accel_rows.append({"timestamp_ms": t, "x": n["accl"][0], "y": n["accl"][1], "z": n["accl"][2]})
            if "gyro" in n and n["gyro"]:
                gyro_rows.append({"timestamp_ms": t, "x": n["gyro"][0], "y": n["gyro"][1], "z": n["gyro"][2]})

    by_t = {}
    for k, v in _flatten_imu(accel_rows, "accel").items():
        by_t.setdefault(k, {}).update(v)
    for k, v in _flatten_imu(gyro_rows, "gyro").items():
        by_t.setdefault(k, {}).update(v)

    gps = []
    try:
        gps = parser.gps() or []
    except Exception as e:
        warnings.append(f"gps() failed: {e}")
        gps = []

    start_time_ms = None
    for g in gps:
        if g.get("timestamp_ms") is None:
            continue
        ms = int(g["timestamp_ms"])
        row = by_t.setdefault(ms, {})
        if "lat" in g: row["lat"] = g["lat"]
        if "lon" in g: row["lon"] = g["lon"]
        if "alt" in g: row["alt"] = g["alt"]
        if "speed_m_s" in g: row["speed"] = g["speed_m_s"]
        if "speed" in g and "speed" not in row: row["speed"] = g["speed"]
        if start_time_ms is None and g.get("time_unix_ms") is not None:
            start_time_ms = g["time_unix_ms"] - ms

    samples = []
    for t in sorted(by_t.keys()):
        row = by_t[t]
        clean = {"t_ms": t}
        for k, v in row.items():
            if v is None: continue
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)): continue
            clean[k] = v
        samples.append(clean)

    if not gps:
        warnings.append("No GPS samples (camera may be paired without GPS remote).")

    print(json.dumps({
        "brand": brand,
        "model": model,
        "start_time_unix_ms": start_time_ms,
        "samples": samples,
        "warnings": warnings,
    }))


main()
`;

export interface NormalizedPythonOutput {
  brand: string;
  model: string;
  start_time_unix_ms: number | null;
  samples: Array<Record<string, number>>;
  warnings: string[];
  error?: string;
}

let shimPathCache: string | null = null;
async function getShimPath(): Promise<string> {
  if (shimPathCache) return shimPathCache;
  const p = join(tmpdir(), `digital-gauges-tp-shim-${randomUUID()}.py`);
  await writeFile(p, PYTHON_SHIM, 'utf8');
  shimPathCache = p;
  return p;
}

/** Run the telemetry-parser shim on a single file. */
export async function runTelemetryParser(filePath: string): Promise<NormalizedPythonOutput> {
  const python = await resolvePython();
  const shimPath = await getShimPath();

  return new Promise((resolve, reject) => {
    const proc = spawn(python, [shimPath, filePath]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`telemetry-parser exited ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as NormalizedPythonOutput);
      } catch (e) {
        reject(new Error(`Failed to parse telemetry-parser output: ${(e as Error).message}\n${stdout}`));
      }
    });
  });
}
