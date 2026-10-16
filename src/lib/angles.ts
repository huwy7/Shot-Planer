// Angle helpers. All angles in degrees; azimuth measured from north, clockwise.

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Normalizes any angle to [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Normalizes a street axis to [0, 180): a street has no direction, so 30° and 210° are the same axis. */
export function normalizeAxis(deg: number): number {
  return ((deg % 180) + 180) % 180;
}

/** Smallest absolute difference between two directions, in [0, 180]. */
export function angularDiff(a: number, b: number): number {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}

/** Smallest difference between a direction and an undirected axis, in [0, 90]. */
export function axisDiff(azimuth: number, axis: number): number {
  const d = angularDiff(azimuth, axis);
  return d > 90 ? 180 - d : d;
}

/** Initial great-circle bearing from point 1 to point 2, in [0, 360). */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

const EARTH_RADIUS_M = 6371008.8;

/** Point reached from a start point after `distanceM` along `bearingDeg` on a sphere. */
export function destination(lat: number, lon: number, bearingDeg: number, distanceM: number): [number, number] {
  const delta = distanceM / EARTH_RADIUS_M;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 =
    lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return [toDeg(phi2), toDeg(lambda2)];
}

/** Converts a SunCalc azimuth (radians, from south, westward positive) to degrees from north, clockwise. */
export function sunCalcAzimuthToDeg(azimuthRad: number): number {
  return normalizeDeg(toDeg(azimuthRad) + 180);
}
