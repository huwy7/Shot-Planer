// Horizon profile of a spot from a surface model (SPEC §11 stage 2). Pure logic; data loading lives in the UI layer.

import { destination, normalizeDeg } from './angles';
import { wgs84ToLv95 } from './lv95';

/** Surface heights on a regular LV95 grid; row 0 is the northern edge. */
export interface HeightGrid {
  /** LV95 easting of the western edge. */
  minE: number;
  /** LV95 northing of the northern edge. */
  maxN: number;
  /** Meters per pixel. */
  res: number;
  width: number;
  height: number;
  /** Row-major heights in meters; NaN = no data. */
  data: Float32Array;
}

export interface HorizonProfile {
  /** Obstruction angle in degrees for azimuth 0..359 (true north, clockwise). */
  deg: number[];
  /** Ground height used for the eye point, m above sea level. */
  groundM: number;
  /** Data source, e.g. "swissSURFACE3D 2023". */
  source: string;
  computedAt: string;
}

export const HORIZON = {
  eyeHeightM: 1.6,
  groundSearchM: 3,
  nearRadiusM: 60,
  farRadiusM: 300,
  minDistanceM: 1,
  minDeg: -10,
} as const;

export function emptyGrid(minE: number, maxN: number, res: number, width: number, height: number): HeightGrid {
  return { minE, maxN, res, width, height, data: new Float32Array(width * height).fill(Number.NaN) };
}

/** Nearest-neighbour height at an LV95 point, or NaN outside the grid / without data. */
export function sampleGrid(g: HeightGrid, e: number, n: number): number {
  const col = Math.floor((e - g.minE) / g.res);
  const row = Math.floor((g.maxN - n) / g.res);
  if (col < 0 || row < 0 || col >= g.width || row >= g.height) return Number.NaN;
  return g.data[row * g.width + col];
}

/** Lowest surface height within `radius` of the point — the street, not a roof edge or car. */
export function groundHeight(g: HeightGrid, e: number, n: number, radius: number = HORIZON.groundSearchM): number {
  let min = Number.NaN;
  for (let dy = -radius; dy <= radius; dy += g.res) {
    for (let dx = -radius; dx <= radius; dx += g.res) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const z = sampleGrid(g, e + dx, n + dy);
      if (!Number.isNaN(z) && (Number.isNaN(min) || z < min)) min = z;
    }
  }
  return min;
}

/**
 * Grid-direction unit vectors for each true azimuth. LV95 grid north differs from true north by the
 * meridian convergence (up to ~1.5° in Switzerland), so directions are derived from real points.
 */
function gridDirections(lat: number, lon: number, origin: { e: number; n: number }): [number, number][] {
  const dirs: [number, number][] = [];
  for (let az = 0; az < 360; az++) {
    const [la, lo] = destination(lat, lon, az, 100);
    const p = wgs84ToLv95(la, lo);
    const de = p.e - origin.e;
    const dn = p.n - origin.n;
    const len = Math.hypot(de, dn);
    dirs.push([de / len, dn / len]);
  }
  return dirs;
}

/**
 * Highest obstruction angle per azimuth, seen from 1.6 m above the ground at the spot.
 * `near` (fine) is used up to 60 m, `far` (coarse) up to 300 m; either may be missing.
 */
export function computeHorizon(
  lat: number,
  lon: number,
  near: HeightGrid | null,
  far: HeightGrid | null,
  source: string,
  now: Date,
): HorizonProfile | null {
  const p = wgs84ToLv95(lat, lon);
  const groundGrid = near ?? far;
  if (!groundGrid) return null;
  const ground = groundHeight(groundGrid, p.e, p.n);
  if (Number.isNaN(ground)) return null;
  const eye = ground + HORIZON.eyeHeightM;
  const dirs = gridDirections(lat, lon, p);

  const deg: number[] = [];
  for (const [ux, uy] of dirs) {
    let best: number = HORIZON.minDeg;
    const scan = (g: HeightGrid | null, from: number, to: number) => {
      if (!g) return;
      for (let d = from; d <= to; d += g.res) {
        const z = sampleGrid(g, p.e + ux * d, p.n + uy * d);
        if (Number.isNaN(z)) continue;
        const a = (Math.atan2(z - eye, d) * 180) / Math.PI;
        if (a > best) best = a;
      }
    };
    scan(near, HORIZON.minDistanceM, HORIZON.nearRadiusM);
    scan(far, near ? HORIZON.nearRadiusM : HORIZON.minDistanceM, HORIZON.farRadiusM);
    deg.push(Math.round(best * 10) / 10);
  }
  return { deg, groundM: Math.round(ground * 10) / 10, source, computedAt: now.toISOString() };
}

/** Obstruction angle at any azimuth, linearly interpolated between whole degrees. */
export function horizonAt(profile: Pick<HorizonProfile, 'deg'>, azimuthDeg: number): number {
  const a = normalizeDeg(azimuthDeg);
  const i = Math.floor(a) % 360;
  const f = a - Math.floor(a);
  return profile.deg[i] * (1 - f) + profile.deg[(i + 1) % 360] * f;
}

/** Validates an untrusted profile (backup import). */
export function parseHorizon(raw: unknown): HorizonProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.deg) || r.deg.length !== 360) return null;
  if (!r.deg.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90)) return null;
  if (typeof r.groundM !== 'number' || !Number.isFinite(r.groundM)) return null;
  if (typeof r.source !== 'string' || r.source.length > 100) return null;
  if (typeof r.computedAt !== 'string' || Number.isNaN(Date.parse(r.computedAt))) return null;
  return { deg: [...(r.deg as number[])], groundM: r.groundM, source: r.source, computedAt: r.computedAt };
}

export interface AxisSuggestion {
  /** Street axis in [0, 180). */
  axisDeg: number;
  /** Mean obstruction along the axis (both directions), degrees. */
  openDeg: number;
  /** How much more obstructed the typical direction is than the axis, degrees. */
  contrastDeg: number;
}

/** Minimum contrast for a corridor to count as a street; below that the spot is open all round. */
export const MIN_AXIS_CONTRAST_DEG = 8;
const AXIS_HALF_WIDTH_DEG = 5;

/**
 * Suggests the street axis as the direction pair (a, a+180) with the lowest obstruction:
 * a street is a corridor that is open at both ends. Returns null without a clear corridor.
 */
export function suggestAxis(profile: Pick<HorizonProfile, 'deg'>): AxisSuggestion | null {
  const h = (az: number) => Math.max(0, profile.deg[((az % 360) + 360) % 360]);
  const mean = (center: number) => {
    let sum = 0;
    for (let d = -AXIS_HALF_WIDTH_DEG; d <= AXIS_HALF_WIDTH_DEG; d++) sum += h(center + d);
    return sum / (2 * AXIS_HALF_WIDTH_DEG + 1);
  };
  const costs: number[] = [];
  for (let a = 0; a < 180; a++) costs.push((mean(a) + mean(a + 180)) / 2);
  let best = 0;
  for (let a = 1; a < 180; a++) if (costs[a] < costs[best]) best = a;
  // A corridor wider than the window gives a plateau of equal minima: take its centre (circular over 180°).
  const tol = 0.05;
  let lo = 0;
  while (lo < 179 && costs[(best - lo - 1 + 180) % 180] <= costs[best] + tol) lo++;
  let hi = 0;
  while (hi < 179 && costs[(best + hi + 1) % 180] <= costs[best] + tol) hi++;
  best = (((best + Math.round((hi - lo) / 2)) % 180) + 180) % 180;
  const median = [...costs].sort((x, y) => x - y)[90];
  const contrast = median - costs[best];
  if (contrast < MIN_AXIS_CONTRAST_DEG) return null;
  return { axisDeg: best, openDeg: Math.round(costs[best] * 10) / 10, contrastDeg: Math.round(contrast * 10) / 10 };
}

/**
 * Outline of the open sky around the spot for the map: long where the horizon is low, short where
 * buildings block it. Returns [lat, lon] points, one per 5°.
 */
export function visibilityOutline(
  profile: Pick<HorizonProfile, 'deg'>,
  lat: number,
  lon: number,
  maxM = 80,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let az = 0; az < 360; az += 5) {
    const block = Math.min(45, Math.max(0, profile.deg[az])) / 45;
    pts.push(destination(lat, lon, az, Math.max(3, maxM * (1 - block))));
  }
  return pts;
}
