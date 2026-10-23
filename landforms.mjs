// The shape of the land: open plains, hill country, mountain ranges, and in
// the desert, dunes and mesas. Pure logic (numbers in, numbers out), shared by
// the worker that builds the terrain and the physics that drives on it.
//
// A broad "land type" field decides where each kind of country lies: 0 is
// flat plains, rising through hills to mountains near 1. Ranges follow long,
// warped belts, so they read as chains of peaks rather than round blobs.
import { noise, smoothstep, clamp, mix } from './noise.mjs?v=terrain-1';

const rotate = (x, z) => [x * .8 - z * .6, x * .6 + z * .8];
// Fractal noise, 0–1: each octave turned and finer, so no grid shows through.
export function fbm(x, z, seed, octaves, gain = .5) {
  let sum = 0, norm = 0, amp = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x, z, seed + i * 17); norm += amp;
    [x, z] = rotate(x * 2.03, z * 2.03); amp *= gain;
  }
  return sum / norm;
}
// Ridged multifractal, 0–1: sharp crests, and each octave's detail weighted by
// the one below, so ridgelines are rugged while valley floors stay smooth.
export function ridged(x, z, seed, octaves) {
  let sum = 0, norm = 0, amp = 1, weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise(x, z, seed + i * 31) * 2 - 1);
    n *= n * weight; weight = clamp(n * 1.8, 0, 1);
    sum += n * amp; norm += amp;
    [x, z] = rotate(x * 2.07, z * 2.07); amp *= .5;
  }
  return sum / norm;
}

// Highest peaks rise about this far above the land around them; snow lies
// above SNOW_LINE (metres above sea level), on the upper third of the peaks,
// and trees give way to alpine meadow and rock around TREELINE.
export const PEAK = 380, SNOW_LINE = 250, TREELINE = 195;
// Plains stay open around the start; ranges may rise beyond about 1.7 km.
const START_PLAINS = 700, START_OPEN = 1700;

export function createLandforms(seed) {
  // 0 plains … 1 mountains.
  function landType(x, z) {
    const wx = (noise(x / 2600 + 3.1, z / 2600 - 7.7, seed + 401) - .5) * .9, wz = (noise(x / 2600 - 5.2, z / 2600 + 1.9, seed + 402) - .5) * .9;
    // A very broad ridged field lifts the land along lines: mountain belts.
    const chain = ridged(x / 7000 + wx * .6, z / 7000 + wz * .6, seed + 404, 2);
    const t = fbm(x / 4200 + wx, z / 4200 + wz, seed + 403, 3) * .62 + chain * .5 - .05;
    return mix(.34, t, smoothstep(START_PLAINS, START_OPEN, Math.hypot(x, z)));
  }
  const mountainOf = t => smoothstep(.52, .66, t), hillsOf = t => smoothstep(.4, .52, t);
  // Broad, warped dry regions (one coarse noise layer would read as squares).
  function desertMask(x, z) {
    const wx = (noise(x / 1900 + 2.2, z / 1900, seed + 192) - .5) * 1.1, wz = (noise(x / 1900, z / 1900 + 6.1, seed + 193) - .5) * 1.1;
    return smoothstep(.5, .62, fbm(x / 3400 + wx, z / 3400 + wz, seed + 191, 3));
  }
  // Everything about the land at a point. offroad (0 on a road, 1 away from
  // it) calms the small rollers under roads, as before.
  function sample(x, z, offroad = 1) {
    const type = landType(x, z), mountain = mountainOf(type), hills = hillsOf(type);
    const desert = desertMask(x, z) * (1 - mountain);
    let h = 12 + (fbm(x / 3200, z / 3200, seed + 410, 2) - .5) * 26;              // broad tilt
    h += (fbm(x / 420, z / 420, seed + 411, 3) - .5) * mix(7, 4, desert);          // plains swell
    h += (fbm(x / 240, z / 240, seed + 412, 4) - .5) * 52 * hills * (1 - .5 * desert); // hill country
    h += (noise(x * .019 + 4.1, z * .019 + 3.2, seed + 31) - .5) * (1.2 + offroad * 5 * (1 - desert)); // rollers
    if (mountain > 0) {
      const wx = (fbm(x / 900 + 9.4, z / 900, seed + 420, 2) - .5) * .8, wz = (fbm(x / 900, z / 900 - 4.4, seed + 421, 2) - .5) * .8;
      const crest = ridged(x / 1150 + wx, z / 1150 + wz, seed + 422, 6), foothills = fbm(x / 700, z / 700, seed + 423, 3);
      h += (Math.pow(crest, 1.35) * PEAK + (foothills - .35) * 70) * mountain;
      // Crags: finer rugged relief on the upper slopes, so faces are not
      // smooth cones up close; the lower slopes stay grassy and smooth.
      const high = smoothstep(.12, .45, crest) * mountain;
      if (high > 0) h += (ridged(x / 95 + wx * 4, z / 95 + wz * 4, seed + 424, 3) - .32) * 16 * high;
    }
    if (desert > .01) {
      // Dunes: long ridges across a slowly turning wind, gentle to windward
      // with a steep lee face, strongest out on the flats.
      const wind = (noise(x / 3000, z / 3000, seed + 430) - .5) * 1.6 + .6;
      const along = (x * Math.cos(wind) + z * Math.sin(wind)) / 150 + (fbm(x / 420, z / 420, seed + 431, 2) - .5) * 2.4;
      const f = along - Math.floor(along);
      const profile = f < .8 ? Math.sin(f / .8 * Math.PI / 2) ** 2 : (1 - (f - .8) / .2) ** 2;
      h += profile * 11 * smoothstep(.35, .65, fbm(x / 800, z / 800, seed + 432, 2)) * desert * (1 - hills) * offroad;
      // Mesas: flat-topped buttes with cliff walls, in the desert hills.
      const m = fbm(x / 520, z / 520, seed + 433, 3);
      h += (smoothstep(.57, .6, m) * 34 + smoothstep(.66, .685, m) * 16) * desert * smoothstep(.2, .6, hills);
    }
    return { height: h, type, mountain, hills, desert };
  }
  return { sample, landType, mountainAt: (x, z) => mountainOf(landType(x, z)), hillsAt: (x, z) => hillsOf(landType(x, z)), desertMask };
}
