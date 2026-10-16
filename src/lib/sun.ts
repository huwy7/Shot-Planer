import { getPosition } from 'suncalc';

/** Sun position in degrees; azimuth from north, clockwise; altitude refraction-corrected. */
export interface SunPos {
  azimuthDeg: number;
  altitudeDeg: number;
}

export type SunFn = (date: Date) => SunPos;

/** SunCalc 2.x already returns degrees with north-based azimuth. */
export function sunAt(lat: number, lon: number): SunFn {
  return (date) => {
    const p = getPosition(date, lat, lon);
    return { azimuthDeg: p.azimuth, altitudeDeg: p.altitude };
  };
}

/** Below this altitude shadows are effectively endless. */
const MIN_SHADOW_ALTITUDE_DEG = 0.5;

/** Shadow length per unit of object height (1/tan(altitude)), or null when the sun is (nearly) down. */
export function shadowFactor(altitudeDeg: number): number | null {
  if (altitudeDeg < MIN_SHADOW_ALTITUDE_DEG) return null;
  return 1 / Math.tan((altitudeDeg * Math.PI) / 180);
}
