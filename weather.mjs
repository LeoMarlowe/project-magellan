// Weather by region: pure logic, no renderer, so the odds are unit-tested.
// Every WEATHER_AREA square and WEATHER_CELL seconds draws one seeded roll,
// and it rains (or snows) when the roll falls under the region's chance. So
// weather is the same for everyone in an area for a couple of minutes, then
// moves on; the game eases between states, so nothing switches abruptly.
import { hash } from './world.mjs?v=roadster-1';
import { SNOW_LINE } from './landforms.mjs?v=classes-2';

export const WEATHER_CELL = 120; // seconds
export const WEATHER_AREA = 2000; // metres
// Chance of precipitation in each kind of region. Snowfields almost always
// snow; deserts are almost always sunny, rain very rarely and never snow;
// pine woods rain 40% of the time; open meadows somewhere in between.
export const PRECIPITATION = { snow: .9, desert: .03, woods: .4, meadow: .2 };
// How cloudy each region's sky usually is (0 clear, 1 overcast): deserts are
// nearly cloudless, mountains often grey. It wanders around this over a few
// minutes, and builds toward overcast shortly before rain or snow.
export const CLOUDINESS = { snow: .66, desert: .1, woods: .48, meadow: .36 };
export const CLOUD_DRIFT_CELL = 80; // seconds between cloudiness keyframes
const GATHER = 35; // seconds of build-up before precipitation starts

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// How much of each region a point belongs to (the weights sum to 1). The snow
// line matches the terrain colouring; sand never lies above it.
export function regionWeights(world, x, z) {
  const snow = smoothstep(SNOW_LINE - 15, SNOW_LINE + 15, world.height(Math.round(x), Math.round(z)));
  const desert = (1 - snow) * world.desertAt(x, z);
  const woods = (1 - snow - desert) * smoothstep(.45, .65, world.woodlandAt(x, z));
  return { snow, desert, woods, meadow: 1 - snow - desert - woods };
}

// The chance of precipitation here, and whether it would fall as snow.
export function precipitationChance(weights) {
  let chance = 0;
  for (const region in PRECIPITATION) chance += PRECIPITATION[region] * (weights[region] ?? 0);
  return { chance, kind: weights.snow > .5 ? 'snow' : 'rain' };
}

// The seeded roll for an area and time cell: uniform in [0, 1), plus how heavy
// any precipitation is.
export function weatherRoll(seed, x, z, time) {
  const ax = Math.floor(x / WEATHER_AREA), az = Math.floor(z / WEATHER_AREA), cell = Math.floor(time / WEATHER_CELL);
  return { roll: hash(ax * 7919 + cell, az * 104729 - cell, seed + 7307), heaviness: .55 + .45 * hash(ax + cell * 31, az - cell * 17, seed + 7311) };
}

// Smooth, seeded wander of the cloud cover: -1 to 1, changing over minutes.
export function cloudWander(seed, x, z, time) {
  const ax = Math.floor(x / WEATHER_AREA), az = Math.floor(z / WEATHER_AREA), t = time / CLOUD_DRIFT_CELL, cell = Math.floor(t);
  const f = smoothstep(0, 1, t - cell), at = c => hash(ax * 613 + c, az * 409 - c, seed + 7321) * 2 - 1;
  return at(cell) * (1 - f) + at(cell + 1) * f;
}

// What the weather should be at a point: 'clear', 'rain' or 'snow', with a
// strength from 0 to 1, and how cloudy the sky is (0–1). A forced kind
// (?weather=…) skips the roll.
export function weatherAt(world, x, z, time, forced = null) {
  const weights = regionWeights(world, x, z), { chance, kind } = precipitationChance(weights);
  const region = Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];
  let base = 0;
  for (const r in CLOUDINESS) base += CLOUDINESS[r] * (weights[r] ?? 0);
  // Desert skies stay mostly clear, so they wander less.
  const clouds = Math.min(.92, Math.max(0, base + cloudWander(world.seed, x, z, time) * (.06 + .2 * base)));
  if (forced) return { kind: forced, strength: forced === 'clear' ? 0 : 1, chance, region, cloudiness: forced === 'clear' ? clouds : 1 };
  const { roll, heaviness } = weatherRoll(world.seed, x, z, time);
  if (roll < chance) return { kind, strength: heaviness, chance, region, cloudiness: 1 };
  // Clouds gather ahead of the next spell of rain or snow.
  const upcoming = weatherRoll(world.seed, x, z, time + GATHER).roll < chance;
  const into = upcoming ? smoothstep(WEATHER_CELL - GATHER, WEATHER_CELL, time % WEATHER_CELL) : 0;
  return { kind: 'clear', strength: 0, chance, region, cloudiness: clouds + (.95 - clouds) * into };
}
