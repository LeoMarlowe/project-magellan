// Rivers: each inland sea is fed by one to three rivers. A river is traced
// upstream from a point on the shore, climbing inland by the broad lie of the
// land and wandering as it goes, for a few kilometres until it reaches the
// hills, a lake or another river. Its water level only ever rises upstream
// (gently, never above the ground beside it), and the land is shaped around
// it: a rounded channel, banks, and a valley floor easing back into the land;
// where it crosses a dip, low banks hold the water in. Pure logic, shared by
// the worker (terrain, water meshes) and the main thread (physics).
import { hash, smoothstep, clamp } from './noise.mjs?v=terrain-1';

// A river ends at most 6 km from its mouth, on its sea's shore: seas further
// than that beyond their shores have no rivers here.
const STEP = 24, BUCKET = 96, SEA_REACH = 6200;
export const RIVER_REACH = 60; // riverAt is exact this far beyond a river's banks

// ground(x, z): natural land height; wet(x, z): over a lake or sea;
// seasNear(x, z, radius); mountainAt(x, z): 0–1.
export function createRivers({ seed, ground, wet, seasNear, mountainAt }) {
  const bySea = new Map(), building = new Map(), buckets = new Map();
  const bounded = (map, limit) => { if (map.size > limit) map.delete(map.keys().next().value); };
  // The land averaged over about 100 m: rivers follow its broad lie, not
  // every small roll.
  const broad = (x, z) => (ground(x, z) + ground(x + 90, z) + ground(x - 90, z) + ground(x, z + 90) + ground(x, z - 90)) / 5;

  // A sea's rivers. Traced at once when something needs them now; ahead of
  // the car, a slice at a time until the clock passes until, when it returns
  // undefined to be carried on later.
  function riversOf(sea, until = Infinity) {
    if (bySea.has(sea.id)) return bySea.get(sea.id);
    let work = building.get(sea.id);
    if (!work) { bounded(building, 50); building.set(sea.id, work = build(sea)); }
    for (let step = work.next(); ; step = work.next()) {
      if (step.done) { building.delete(sea.id); bounded(bySea, 200); bySea.set(sea.id, step.value); return step.value; }
      if (performance.now() > until) return undefined;
    }
  }
  function* build(sea) {
    const key = [...sea.id].reduce((h, c) => h * 31 + c.charCodeAt(0) | 0, 7);
    const count = 1 + (hash(key, 1, seed + 2200) < .65) + (hash(key, 2, seed + 2200) < .3), list = [], base = hash(key, 3, seed + 2200) * Math.PI * 2;
    for (let r = 0; r < count; r++) {
      const angle = base + r * Math.PI * 2 / count + (hash(key, 10 + r, seed + 2200) - .5) * 1.2;
      const river = yield* trace(`${sea.id}/${r}`, sea, angle, 2500 + 3500 * hash(key, 20 + r, seed + 2200), list);
      if (river) list.push(river);
    }
    return list;
  }
  // A generator, pausing every few steps.
  function* trace(id, sea, angle, length, siblings) {
    let ox = Math.sin(angle), oz = Math.cos(angle), x = sea.x, z = sea.z;
    // Walk out from the middle of the sea to its shore: the river's mouth.
    for (let k = 0; k < 200 && wet(x, z); k++) { x += ox * 20; z += oz * 20; }
    if (wet(x, z)) return null;
    x -= ox * 30; z -= oz * 30; // start just inside the water
    const xs = [x], zs = [z];
    let dx = ox, dz = oz;
    for (let k = 1; k * STEP < length; k++) {
      if (k % 8 === 0) yield;
      // Upstream climbs the broad slope, keeps heading away from the sea, and wanders.
      const gx = (broad(x + 40, z) - broad(x - 40, z)) / 80, gz = (broad(x, z + 40) - broad(x, z - 40)) / 80, g = Math.hypot(gx, gz) || 1;
      dx = dx * .62 + gx / g * .23 + ox * .15; dz = dz * .62 + gz / g * .23 + oz * .15;
      const wander = (hash(Math.round(x / 140), Math.round(z / 140), seed + 2210) - .5) * .55, c = Math.cos(wander), s = Math.sin(wander);
      [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
      const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      const nx = x + dx * STEP, nz = z + dz * STEP;
      // It rises in the foothills, at a lake, or where it would meet another river.
      if (k > 4 && (wet(nx, nz) || mountainAt(nx, nz) > .35)) break;
      if (siblings.some(o => near(o, nx, nz, 90))) break;
      // Nor may it wander back beside its own lower reaches.
      let looped = false;
      for (let m = 0; m < xs.length - 6 && !looped; m += 2) looped = Math.hypot(xs[m] - nx, zs[m] - nz) < 60;
      if (looped) break;
      xs.push(nx); zs.push(nz); x = nx; z = nz;
    }
    const count = xs.length;
    if (count < 40) return null; // under a kilometre: not worth a river
    // Index 0 is the source; the last point is in the sea.
    xs.reverse(); zs.reverse();
    const points = new Float32Array(count * 2), level = new Float32Array(count), width = new Float32Array(count), depth = new Float32Array(count);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let k = count - 1; k >= 0; k--) {
      const h = ground(xs[k], zs[k]);
      // From the mouth upstream: rising at most 3%, never above the ground.
      level[k] = k === count - 1 ? sea.level - .05 : Math.max(level[k + 1], Math.min(h - .8, level[k + 1] + STEP * .03));
      const fromSource = k * STEP, grown = smoothstep(0, 3000, fromSource);
      width[k] = 5 + 21 * grown; depth[k] = 1 + 2.4 * grown;
      points[k * 2] = xs[k]; points[k * 2 + 1] = zs[k];
      x0 = Math.min(x0, xs[k]); x1 = Math.max(x1, xs[k]); z0 = Math.min(z0, zs[k]); z1 = Math.max(z1, zs[k]);
    }
    return { id, points, level, width, depth, count, length: (count - 1) * STEP, sea: sea.id, box: [x0, z0, x1, z1] };
  }
  function near(r, x, z, d) {
    if (x < r.box[0] - d || x > r.box[2] + d || z < r.box[1] - d || z > r.box[3] + d) return false;
    for (let k = 0; k < r.count; k += 2) if (Math.hypot(r.points[k * 2] - x, r.points[k * 2 + 1] - z) < d) return true;
    return false;
  }
  function riversNear(x, z, radius) {
    const found = [];
    for (const sea of seasNear(x, z, radius + SEA_REACH)) for (const r of riversOf(sea))
      if (r.box[0] < x + radius && r.box[2] > x - radius && r.box[1] < z + radius && r.box[3] > z - radius) found.push(r);
    return found;
  }
  function bucket(bx, bz) {
    const key = `${bx},${bz}`;
    if (buckets.has(key)) return buckets.get(key);
    const pad = 15 + RIVER_REACH, x0 = bx * BUCKET - pad, z0 = bz * BUCKET - pad, x1 = (bx + 1) * BUCKET + pad, z1 = (bz + 1) * BUCKET + pad, list = [];
    for (const r of riversNear(bx * BUCKET + BUCKET / 2, bz * BUCKET + BUCKET / 2, BUCKET + pad)) for (let k = 0; k < r.count - 1; k++) {
      const ax = r.points[k * 2], az = r.points[k * 2 + 1], cx = r.points[k * 2 + 2], cz = r.points[k * 2 + 3];
      if (Math.max(ax, cx) < x0 || Math.min(ax, cx) > x1 || Math.max(az, cz) < z0 || Math.min(az, cz) > z1) continue;
      list.push(r, k);
    }
    bounded(buckets, 1500); buckets.set(key, list);
    return list;
  }
  // The nearest river: distance from its centre line, and its width, depth
  // and water level there (null when none is near).
  function riverAt(x, z) {
    const list = bucket(Math.floor(x / BUCKET), Math.floor(z / BUCKET));
    let best = Infinity, br = null, bk = 0, bt = 0;
    for (let n = 0; n < list.length; n += 2) {
      const r = list[n], k = list[n + 1], p = r.points, ax = p[k * 2], az = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, dz = p[k * 2 + 3] - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1), ex = ax + dx * t - x, ez = az + dz * t - z, d2 = ex * ex + ez * ez;
      if (d2 < best) { best = d2; br = r; bk = k; bt = t; }
    }
    if (!br) return null;
    const lerp = a => a[bk] + (a[bk + 1] - a[bk]) * bt;
    return { d: Math.sqrt(best), level: lerp(br.level), width: lerp(br.width), depth: lerp(br.depth), id: br.id };
  }
  // The land shaped around rivers: a rounded channel below the water, banks
  // just above it (raised a little where the land dips), and a valley floor
  // easing back into the land.
  function carve(x, z, h) {
    const r = riverAt(x, z);
    if (!r) return h;
    const half = r.width / 2, valley = half + 10 + Math.min(RIVER_REACH, Math.abs(h - r.level) * 1.4);
    if (r.d > valley) return h;
    const target = r.d < half ? r.level - r.depth * (1 - (r.d / half) ** 2) : r.level + .6 + (r.d - half) * .25;
    return h + (target - h) * (1 - smoothstep(half + 4, valley, r.d));
  }
  function prepare(x, z, radius, budgetMs) {
    const until = performance.now() + budgetMs;
    for (const sea of seasNear(x, z, radius + SEA_REACH)) if (performance.now() > until || riversOf(sea, until) === undefined) return false;
    return true;
  }
  return { riverAt, riversNear, carve, prepare };
}
