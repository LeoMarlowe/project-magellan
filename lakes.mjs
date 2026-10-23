// Seeded basins repeat across the endless landscape. Water and terrain share
// these descriptors, so there is no separate invisible shoreline collider.
// Two kinds: small ponds on an 840 m grid, and inland seas 1–1.6 km across on
// a sparse 4 km grid. Seas have irregular shorelines and claim their area, so
// no pond overlaps one.
const spacing = 840;
export const SEA_SPACING = 4000;
const SEA_REACH = 1.5; // a sea reshapes the terrain out to 1.5 shoreline radii
const SEA_NAMES = ['THE INLAND SEA', 'LONG REACH', 'THE BROAD WATER', 'STILL SOUND', 'GREAT MERE', 'THE WIDE WATER'];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hash(x, z, seed) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// Shoreline radius multiplier around a basin: 1 for ponds, a few low
// harmonics for seas so their coasts have bays and headlands.
function shapeAt(lake, angle) {
  let r = 1;
  for (const [k, a, phase] of lake.shape) r += a * Math.sin(k * angle + phase);
  return r;
}
// Normalized distance from a basin's centre: 1 at its nominal shoreline.
export function lakeRadius(lake, x, z) {
  const u = (x - lake.x) / lake.rx, v = (z - lake.z) / lake.rz;
  return Math.hypot(u, v) / (lake.shape.length ? shapeAt(lake, Math.atan2(v, u)) : 1);
}
export function lakeExtent(lake) { return Math.max(lake.rx, lake.rz) * (1 + lake.shape.reduce((sum, [, a]) => sum + a, 0)); }

// baseHeight: the natural land (roads route around the lakes, so lakes never
// depend on roads); roadAt: lets the shoreline reshaping spare nearby roads.
export function createLakes(seed, baseHeight, roadAt) {
  const ponds = new Map(), seas = new Map();
  function rimLevel(lake) {
    // Keep the water below every natural rim. A basin on a mountainside must
    // not end in a vertical sheet.
    const samples = lake.shape.length ? 96 : 64;
    for (let i = 0; i < samples; i++) {
      const a = i * Math.PI * 2 / samples, s = shapeAt(lake, Math.atan2(Math.cos(a), Math.sin(a))) * 1.02;
      const px = lake.x + Math.sin(a) * lake.rx * s, pz = lake.z + Math.cos(a) * lake.rz * s;
      lake.level = Math.min(lake.level, baseHeight(px, pz) - 2.5);
    }
  }
  function seaAtCell(cx, cz) {
    const key = `${cx},${cz}`;
    if (seas.has(key)) return seas.get(key);
    // The starter sea lies about a kilometre from spawn, beyond the first ramps.
    const starter = cx === 0 && cz === -1;
    let sea = null;
    if (starter || hash(cx, cz, seed + 2901) < .62) {
      const jitter = k => (hash(cx, cz, seed + 2902 + k) - .5) * .3;
      const x = starter ? 1700 : (cx + .5 + jitter(0)) * SEA_SPACING, z = starter ? -1550 : (cz + .5 + jitter(1)) * SEA_SPACING;
      const shape = [[2, .05 + hash(cx, cz, seed + 2905) * .08, hash(cx, cz, seed + 2906) * 6.283],
        [3, .03 + hash(cx, cz, seed + 2907) * .06, hash(cx, cz, seed + 2908) * 6.283],
        [5, hash(cx, cz, seed + 2909) * .04, hash(cx, cz, seed + 2910) * 6.283]];
      sea = { id: `sea:${key}`, sea: true, x, z, shape,
        rx: starter ? 560 : 420 + hash(cx, cz, seed + 2903) * 230, rz: starter ? 500 : 420 + hash(cx, cz, seed + 2904) * 230,
        level: baseHeight(x, z) - 1.5, depth: 14 + hash(cx, cz, seed + 2911) * 8,
        name: starter ? SEA_NAMES[0] : SEA_NAMES[Math.floor(hash(cx, cz, seed + 2912) * SEA_NAMES.length)] };
      rimLevel(sea);
    }
    // Rivers look for seas up to 12 km away (about 64 sea cells): keep plenty.
    if (seas.size >= 512) seas.delete(seas.keys().next().value);
    seas.set(key, sea); return sea;
  }
  // Sea centres stay within ±15% of their cell's middle and reach at most
  // ~1.2 km, so the sea for any point is always the one in its own cell.
  function seaAt(x, z) { return seaAtCell(Math.floor(x / SEA_SPACING), Math.floor(z / SEA_SPACING)); }
  function pondAtCell(cx, cz) {
    const key = `${cx},${cz}`;
    if (ponds.has(key)) return ponds.get(key);
    const starter = cx === 0 && cz === 0;
    // Scattered well across their cells, so from the air they never line up
    // (each still within its own cell's reach, so lookups always find it).
    const x = starter ? 180 : cx * spacing + 210 + (hash(cx, cz, seed + 1801) - .5) * 320;
    const z = starter ? 160 : cz * spacing + 210 + (hash(cx, cz, seed + 1802) - .5) * 320;
    // Seas claim their surroundings: no pond's basin may overlap a sea's,
    // including a sea in the neighbouring cell when the pond sits near its edge.
    const clear = [-320, 320].every(dx => [-320, 320].every(dz => {
      const sea = seaAt(x + dx, z + dz);
      return !sea || Math.hypot(x - sea.x, z - sea.z) > lakeExtent(sea) * SEA_REACH + 320;
    }));
    // A pond needs a basin: on a hillside or mountain slope, where the land
    // around it falls away more than a few metres, it would be dug in as a pit.
    let lo = Infinity, hi = -Infinity;
    if (clear && !starter) for (let i = 0; i < 16; i++) {
      const h = baseHeight(x + Math.sin(i * Math.PI / 8) * 120, z + Math.cos(i * Math.PI / 8) * 125);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    let pond = null;
    if (clear && (starter || (hi - lo < 14 && hash(cx, cz, seed + 1806) < .65))) {
      pond = { id: `lake:${key}`, x, z, shape: [], rx: starter ? 96 : 100 + hash(cx, cz, seed + 1803) * 28,
        rz: starter ? 108 : 104 + hash(cx, cz, seed + 1804) * 30,
        level: baseHeight(x, z) - 1.5, depth: 8 + hash(cx, cz, seed + 1805) * 4,
        name: starter ? 'MIRROR LAKE' : 'THE LAKES' };
      rimLevel(pond);
    }
    if (ponds.size >= 128) ponds.delete(ponds.keys().next().value);
    ponds.set(key, pond); return pond;
  }
  function lakeAt(x, z) {
    const sea = seaAt(x, z);
    if (sea && lakeRadius(sea, x, z) < SEA_REACH) return sea;
    const pond = pondAtCell(Math.round((x - 210) / spacing), Math.round((z - 210) / spacing));
    return pond && lakeRadius(pond, x, z) < 2.1 ? pond : null;
  }
  function carve(x, z, original) {
    const lake = lakeAt(x, z); if (!lake) return original;
    const r = lakeRadius(lake, x, z);
    if (lake.sea) {
      // Broad, gently shelving coasts, sparing the roads (and bridge
      // approaches) that run along or beside them.
      const basin = lake.level - lake.depth * (1 - smooth(.3, 1, r)) + smooth(.88, 1.12, r) * 3 + Math.max(0, r - 1.12) * 12;
      return original + (basin - original) * (1 - smooth(1.05, SEA_REACH, r)) * (r < 1 ? 1 : smooth(10, 50, roadAt(x, z).d));
    }
    const basin = lake.level - lake.depth * (1 - smooth(.18, .98, r)) + smooth(.88, 1.15, r) * 3 + Math.max(0, r - 1.15) * 10;
    const weight = (1 - smooth(1.05, 2.1, r)) * smooth(12, 110, roadAt(x, z).d);
    return original + (basin - original) * weight;
  }
  function near(x, z, radius = 900) {
    const result = [];
    for (let cx = Math.floor((x - radius - 210) / spacing); cx <= Math.ceil((x + radius - 210) / spacing); cx++) {
      for (let cz = Math.floor((z - radius - 210) / spacing); cz <= Math.ceil((z + radius - 210) / spacing); cz++) {
        const pond = pondAtCell(cx, cz);
        if (pond && Math.hypot(pond.x - x, pond.z - z) < radius + Math.max(pond.rx, pond.rz)) result.push(pond);
      }
    }
    return result.concat(seasNear(x, z, radius));
  }
  // Seas only: cheap enough to search out to the far horizon when flying.
  function seasNear(x, z, radius) {
    const result = [];
    for (let cx = Math.floor((x - radius - 1400) / SEA_SPACING); cx <= Math.floor((x + radius + 1400) / SEA_SPACING); cx++) {
      for (let cz = Math.floor((z - radius - 1400) / SEA_SPACING); cz <= Math.floor((z + radius + 1400) / SEA_SPACING); cz++) {
        const sea = seaAtCell(cx, cz);
        if (sea && Math.hypot(sea.x - x, sea.z - z) < radius + lakeExtent(sea)) result.push(sea);
      }
    }
    return result;
  }
  return { carve, lakeAt, near, seasNear, starter: pondAtCell(0, 0), starterSea: seaAtCell(0, -1) };
}

export function waterWave(x, z, time) {
  return Math.sin(x * .11 + z * .07 + time * 1.6) * .045 + Math.sin(x * -.06 + z * .14 - time * 1.2) * .025;
}
