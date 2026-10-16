// WGS84 → Swiss LV95 (EPSG:2056), swisstopo approximate formulas (accuracy ~1 m within Switzerland).

export interface Lv95 {
  e: number;
  n: number;
}

export function wgs84ToLv95(lat: number, lon: number): Lv95 {
  const phi = (lat * 3600 - 169028.66) / 10000;
  const lambda = (lon * 3600 - 26782.5) / 10000;
  const e =
    2600072.37 + 211455.93 * lambda - 10938.51 * lambda * phi - 0.36 * lambda * phi ** 2 - 44.54 * lambda ** 3;
  const n =
    1200147.07 +
    308807.95 * phi +
    3745.25 * lambda ** 2 +
    76.63 * phi ** 2 -
    194.56 * lambda ** 2 * phi +
    119.79 * phi ** 3;
  return { e, n };
}

/** Rough check that a point lies in the swisstopo data area (Switzerland and surroundings). */
export function isInSwitzerland(lat: number, lon: number): boolean {
  return lat >= 45.7 && lat <= 47.9 && lon >= 5.8 && lon <= 10.6;
}
