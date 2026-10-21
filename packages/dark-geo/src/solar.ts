// Solar and lunar position for an observer. [K] NOAA solar calculator equations
// (after Meeus, Astronomical Algorithms, 2nd ed., ch. 25), accurate to roughly
// 0.01 degree for 1800-2100; no refraction below -0.575 degree is modelled.
// Moon: low-precision Meeus ch. 47 leading terms (~0.5 degree); used only for
// sky appearance, never for navigation.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

export interface SunPosition { elevation: number; azimuth: number; declination: number; equationOfTimeMin: number }

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const jd = julianDay(date);
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * D2R) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * D2R) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * D2R) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * D2R);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * D2R);
  const decl = Math.asin(Math.sin(eps * D2R) * Math.sin(lambda * D2R)) * R2D;
  const y = Math.tan((eps / 2) * D2R) ** 2;
  const eqTime = 4 * R2D * (y * Math.sin(2 * L0 * D2R) - 2 * e * Math.sin(M * D2R) + 4 * e * y * Math.sin(M * D2R) * Math.cos(2 * L0 * D2R) - 0.5 * y * y * Math.sin(4 * L0 * D2R) - 1.25 * e * e * Math.sin(2 * M * D2R));
  const minutesUtc = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 60000;
  const trueSolarTime = (((minutesUtc + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;
  const cosZen = Math.sin(lat * D2R) * Math.sin(decl * D2R) + Math.cos(lat * D2R) * Math.cos(decl * D2R) * Math.cos(hourAngle * D2R);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZen))) * R2D;
  const elevation = 90 - zenith;
  let az: number;
  const denom = Math.cos(lat * D2R) * Math.sin(zenith * D2R);
  if (Math.abs(denom) > 1e-9) {
    const cosAz = (Math.sin(lat * D2R) * Math.cos(zenith * D2R) - Math.sin(decl * D2R)) / denom;
    const a = Math.acos(Math.max(-1, Math.min(1, cosAz))) * R2D;
    az = hourAngle > 0 ? (a + 180) % 360 : (540 - a) % 360;
  } else az = lat > 0 ? 180 : 0;
  return { elevation: elevation + refraction(elevation), azimuth: az, declination: decl, equationOfTimeMin: eqTime };
}

/** NOAA atmospheric refraction approximation (degrees). */
function refraction(el: number): number {
  if (el > 85) return 0;
  const te = Math.tan(el * D2R);
  let r: number;
  if (el > 5) r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (el > -0.575) r = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
  else r = -20.774 / te;
  return r / 3600;
}

export interface MoonPosition { elevation: number; azimuth: number; illumination: number }

export function moonPosition(date: Date, lat: number, lon: number): MoonPosition {
  const d = julianDay(date) - 2451545;
  const L = (218.316 + 13.176396 * d) * D2R;
  const M = (134.963 + 13.064993 * d) * D2R;
  const F = (93.272 + 13.22935 * d) * D2R;
  const lambda = L + 6.289 * D2R * Math.sin(M);
  const beta = 5.128 * D2R * Math.sin(F);
  const eps = 23.4397 * D2R;
  const ra = Math.atan2(Math.sin(lambda) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), Math.cos(lambda));
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lambda));
  const gmst = (280.16 + 360.9856235 * d) * D2R;
  const H = gmst + lon * D2R - ra;
  const phi = lat * D2R;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
  // Illuminated fraction from elongation to the Sun.
  const sunL = (280.46 + 0.9856474 * d) * D2R;
  const elong = Math.acos(Math.cos(beta) * Math.cos(lambda - sunL));
  return { elevation: el * R2D, azimuth: ((az * R2D) % 360 + 360) % 360, illumination: (1 - Math.cos(elong)) / 2 };
}

/** Local mean solar time offset (hours) from UTC: lon/15. Not a civil time zone. */
export function solarOffsetHours(lon: number): number {
  return lon / 15;
}
