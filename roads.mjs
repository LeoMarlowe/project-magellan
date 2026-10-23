// The road network: waypoints on open ground, one per ROAD_CELL square, joined
// by routes that find their way around steep ground, mountains and water, so
// roads follow valleys, cross ranges at passes, and curve with the land. Pure
// logic (numbers in, numbers out), shared by the worker that builds the
// terrain and its road maps and the main thread that drives on it.
//
// Every route depends only on its two waypoints and the land between them, so
// the network is endless and the same whichever way you reach it.
import { hash, smoothstep, clamp } from './noise.mjs?v=terrain-1';

export const ROAD_CELL = 1400;
export const ROAD_HALF = 4.7;
const LATTICE = 48;      // routing grid spacing, metres
const STEP = 10;         // spacing of the finished road's points
const MAX_GRADE = .11;   // steepest the finished road may climb
const MAX_CUT = 28;      // deepest cutting or highest embankment a road may need
const CREST_RADIUS = 650, RAMP_GRADE = .08; // a bridge approach's rounded crest (metres) and its steepest grade
const BUCKET = 96;       // road lookups are listed per 96 m square (a terrain chunk)
const NO_PASSING_BEND = 110, NO_PASSING_CREST = 900; // radii (m): tighter bends and crests get a solid centre line
const JUNCTION_KINK = .82;   // two roads meeting straighter than about 145° just continue (a junction otherwise)
export const ROAD_REACH = 80; // roadAt is exact within this distance of a road
export const ROAD_MAP = 128;  // road map texels per terrain tile side

// ground(x, z): the natural land height; mountainAt(x, z): 0–1;
// wet(x, z): true over lakes and seas; riverCost(x, z): extra cost near a
// river, so roads cross rivers where they are narrow rather than follow them.
export function createRoads({ seed, ground, mountainAt, wet, riverCost = () => 0, riverAt = () => null }) {
  const nodes = new Map(), edges = new Map(), building = new Map(), buckets = new Map();
  const bounded = (map, limit) => { if (map.size > limit) map.delete(map.keys().next().value); };

  // A waypoint on the flattest open ground in its cell, or none in deep
  // mountains or water. The start of the world is a waypoint, and the cells
  // north and south of it keep theirs near the same line, so the first road
  // runs north from where the car starts.
  function nodeAt(i, j) {
    const key = `${i},${j}`;
    if (nodes.has(key)) return nodes.get(key);
    let best = null;
    if (i === 0 && j === 0) best = { x: 0, z: 0, score: 0 };
    else for (let k = 0; k < 8; k++) {
      const u = hash(i, j, seed + 1500 + k * 2), v = hash(i, j, seed + 1501 + k * 2);
      const x = i === 0 && Math.abs(j) === 1 ? (u - .5) * 120 : (i + .2 + .6 * u) * ROAD_CELL;
      const z = (j + .2 + .6 * v) * ROAD_CELL;
      const slope = (Math.abs(ground(x + 24, z) - ground(x - 24, z)) + Math.abs(ground(x, z + 24) - ground(x, z - 24))) / 48;
      const score = mountainAt(x, z) * 4 + slope * 6 + (wet(x, z) ? 100 : 0);
      if (!best || score < best.score) best = { x, z, score };
    }
    const node = best.score < 3 ? { id: key, i, j, x: best.x, z: best.z, y: ground(best.x, best.z) } : null;
    bounded(nodes, 4000); nodes.set(key, node);
    return node;
  }

  // Cheapest path on a lattice: distance, with climbing (grade squared),
  // mountains and water made expensive, so routes prefer gentle open ground.
  // A generator: it pauses every few dozen cells so the work can be spread
  // over frames (see edge).
  function* route(a, b) {
    const span = Math.hypot(b.x - a.x, b.z - a.z), margin = clamp(span * .4, 300, 600);
    const x0 = Math.min(a.x, b.x) - margin, z0 = Math.min(a.z, b.z) - margin;
    const nx = Math.ceil((Math.max(a.x, b.x) + margin - x0) / LATTICE) + 1, nz = Math.ceil((Math.max(a.z, b.z) + margin - z0) / LATTICE) + 1;
    const n = nx * nz, heights = new Float32Array(n).fill(NaN), penalty = new Float32Array(n).fill(NaN);
    const at = k => {
      if (Number.isNaN(heights[k])) {
        const x = x0 + (k % nx) * LATTICE, z = z0 + Math.floor(k / nx) * LATTICE;
        heights[k] = ground(x, z); penalty[k] = wet(x, z) ? 400 : 1 + 2.5 * mountainAt(x, z) + riverCost(x, z);
      }
      return k;
    };
    const cell = (x, z) => clamp(Math.round((z - z0) / LATTICE), 0, nz - 1) * nx + clamp(Math.round((x - x0) / LATTICE), 0, nx - 1);
    const start = cell(a.x, a.z), goal = cell(b.x, b.z), gx = goal % nx, gz = Math.floor(goal / nx);
    const cost = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    // A binary heap of [priority, index].
    const heap = [];
    const push = (p, k) => { heap.push([p, k]); let c = heap.length - 1; while (c) { const q = (c - 1) >> 1; if (heap[q][0] <= heap[c][0]) break; [heap[q], heap[c]] = [heap[c], heap[q]]; c = q; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    cost[start] = 0; push(0, start);
    const moves = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [1, 2], [-2, 1], [-1, 2], [2, -1], [1, -2], [-2, -1], [-1, -2]];
    for (let visited = 1; heap.length; visited++) {
      if (visited % 64 === 0) yield;
      const [, k] = pop();
      if (done[k]) continue;
      done[k] = 1;
      if (k === goal) break;
      const kx = k % nx, kz = Math.floor(k / nx), hk = heights[at(k)];
      for (const [dx, dz] of moves) {
        const mx = kx + dx, mz = kz + dz;
        if (mx < 0 || mz < 0 || mx >= nx || mz >= nz) continue;
        const m = mz * nx + mx;
        if (done[m]) continue;
        const length = Math.hypot(dx, dz) * LATTICE, grade = (heights[at(m)] - hk) / length;
        const step = length * (1 + 70 * grade * grade) * (penalty[k] + penalty[m]) / 2;
        if (cost[k] + step < cost[m]) {
          cost[m] = cost[k] + step; from[m] = k;
          push(cost[m] + Math.hypot(mx - gx, mz - gz) * LATTICE, m);
        }
      }
    }
    if (!Number.isFinite(cost[goal]) || cost[goal] > span * 60) return null;
    const path = [];
    for (let k = goal; k !== -1; k = from[k]) path.push([x0 + (k % nx) * LATTICE, z0 + Math.floor(k / nx) * LATTICE]);
    path.reverse(); path[0] = [a.x, a.z]; path[path.length - 1] = [b.x, b.z];
    return path;
  }

  // Round the lattice path into flowing curves, space its points evenly, and
  // give it a height profile: the land smoothed along the way, pinned to the
  // waypoints, with the grade capped. The land is then cut and filled to it.
  function finish(id, a, b, path) {
    for (let pass = 0; pass < 4; pass++) {
      const next = [path[0]];
      for (let k = 0; k < path.length - 1; k++) {
        const [x1, z1] = path[k], [x2, z2] = path[k + 1];
        next.push([x1 * .75 + x2 * .25, z1 * .75 + z2 * .25], [x1 * .25 + x2 * .75, z1 * .25 + z2 * .75]);
      }
      next.push(path[path.length - 1]); path = next;
    }
    const lengths = [0];
    for (let k = 1; k < path.length; k++) lengths.push(lengths[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]));
    const total = lengths[lengths.length - 1], count = Math.max(2, Math.round(total / STEP) + 1);
    const points = new Float32Array(count * 2), level = new Float32Array(count), raw = new Float32Array(count);
    for (let i = 0, k = 0; i < count; i++) {
      const s = total * i / (count - 1);
      while (k < path.length - 2 && lengths[k + 1] < s) k++;
      const t = clamp((s - lengths[k]) / (lengths[k + 1] - lengths[k] || 1), 0, 1);
      points[i * 2] = path[k][0] + (path[k + 1][0] - path[k][0]) * t; points[i * 2 + 1] = path[k][1] + (path[k + 1][1] - path[k][1]) * t;
      raw[i] = ground(points[i * 2], points[i * 2 + 1]);
    }
    if (total > Math.hypot(b.x - a.x, b.z - a.z) * 2.4) return null; // a long detour: no road here
    for (let i = 0; i < count; i++) {
      let sum = 0, weight = 0;
      for (let k = Math.max(0, i - 6); k <= Math.min(count - 1, i + 6); k++) { const w = 7 - Math.abs(k - i); sum += raw[k] * w; weight += w; }
      level[i] = sum / weight;
    }
    level[0] = a.y; level[count - 1] = b.y;
    // Bridges: where the road crosses a river it runs on a level deck about
    // 3 m above the water.
    const fixed = new Uint8Array(count), bridges = [];
    fixed[0] = fixed[count - 1] = 1;
    for (let i = 0; i < count;) {
      const r = riverAt(points[i * 2], points[i * 2 + 1]);
      if (!r || r.d > r.width / 2 + 8) { i++; continue; }
      let j = i, top = r.level;
      for (; j < count; j++) { const q = riverAt(points[j * 2], points[j * 2 + 1]); if (!q || q.d > q.width / 2 + 8) break; top = Math.max(top, q.level); }
      const i0 = Math.max(1, i - 1), i1 = Math.min(count - 2, j);
      let deck = top + 3.2;
      for (let k = i0; k <= i1; k++) deck = Math.max(deck, level[k]);
      for (let k = i0; k <= i1; k++) { level[k] = deck; fixed[k] = 1; }
      bridges.push({ i0, i1, level: deck });
      i = j + 1;
    }
    // The approaches ease up to each deck over a long rounded crest, gentle
    // enough that a car at full speed stays on the road, then fall at up to
    // 8% to meet the road's own profile (always in a dip, never a crest).
    // Junctions keep their height; the grade cap below joins them in.
    const unit = total / (count - 1), curve = CREST_RADIUS * RAMP_GRADE;
    const crest = x => x < curve ? x * x / (2 * CREST_RADIUS) : RAMP_GRADE * (x - curve / 2);
    for (const b of bridges) for (let i = 0; i < count; i++) {
      const dist = (i < b.i0 ? b.i0 - i : i > b.i1 ? i - b.i1 : 0) * unit;
      if (dist && !fixed[i]) level[i] = Math.max(level[i], b.level - crest(dist));
    }
    const rise = MAX_GRADE * total / (count - 1);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < count; i++) if (!fixed[i]) level[i] = clamp(level[i], level[i - 1] - rise, level[i - 1] + rise);
      for (let i = count - 2; i >= 0; i--) if (!fixed[i]) level[i] = clamp(level[i], level[i + 1] - rise, level[i + 1] + rise);
    }
    let cut = 0;
    for (let i = 0; i < count; i++) cut = Math.max(cut, Math.abs(level[i] - raw[i]));
    if (cut > MAX_CUT) return null; // it would need a tunnel or a viaduct
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < count; i++) { x0 = Math.min(x0, points[i * 2]); x1 = Math.max(x1, points[i * 2]); z0 = Math.min(z0, points[i * 2 + 1]); z1 = Math.max(z1, points[i * 2 + 1]); }
    return { id, points, level, count, length: total, bridges, box: [x0, z0, x1, z1], ...profile(points, level, count, unit) };
  }
  // How the finished road bends and rises, for its markings and roadside:
  // curve (radians per metre, smoothed over 60 m; positive bends to the
  // left), solid (1 where the centre line is solid: tight bends and crests
  // too sharp to see over, from 45 m before to 45 m after), and sag (0–1:
  // dips, where rain water pools).
  function profile(points, level, count, unit) {
    const turn = new Float32Array(count), curve = new Float32Array(count), solid = new Uint8Array(count), sag = new Float32Array(count), mark = new Uint8Array(count);
    for (let k = 1; k < count - 1; k++) {
      const a = Math.atan2(points[k * 2] - points[k * 2 - 2], points[k * 2 + 1] - points[k * 2 - 1]), b = Math.atan2(points[k * 2 + 2] - points[k * 2], points[k * 2 + 3] - points[k * 2 + 1]);
      turn[k] = Math.atan2(Math.sin(b - a), Math.cos(b - a)) / unit;
    }
    for (let k = 0; k < count; k++) {
      let sum = 0, n = 0;
      for (let m = Math.max(0, k - 3); m <= Math.min(count - 1, k + 3); m++) { sum += turn[m]; n++; }
      curve[k] = sum / n;
      const bend = k > 0 && k < count - 1 ? (level[k - 1] + level[k + 1] - 2 * level[k]) / (unit * unit) : 0;
      mark[k] = Math.abs(curve[k]) > 1 / NO_PASSING_BEND || bend < -1 / NO_PASSING_CREST ? 1 : 0;
      sag[k] = smoothstep(1 / 3000, 1 / 700, bend);
    }
    const reach = Math.round(45 / unit);
    for (let k = 0; k < count; k++) for (let m = Math.max(0, k - reach); m <= Math.min(count - 1, k + reach) && !solid[k]; m++) solid[k] = mark[m];
    return { curve, solid, sag };
  }

  function* build(id, a, b) { const path = yield* route(a, b); yield; return path && finish(id, a, b, path); }
  // The road from waypoint a to b (null if there is none). Built at once when
  // something needs it now; ahead of the car, a slice at a time until the
  // clock passes until, when it returns undefined to be carried on later.
  function edge(a, b, until = Infinity) {
    if (!a || !b) return null;
    const id = `${a.id}>${b.id}`;
    if (edges.has(id)) return edges.get(id);
    let work = building.get(id);
    if (!work) { bounded(building, 50); building.set(id, work = build(id, a, b)); }
    for (let step = work.next(); ; step = work.next()) {
      if (step.done) { building.delete(id); bounded(edges, 3000); edges.set(id, step.value); return step.value; }
      if (performance.now() > until) return undefined;
    }
  }
  // The roads leaving a cell: east, north, and in one of every few squares a
  // diagonal (never both diagonals of a square, so they cannot cross).
  function pairsFrom(i, j) {
    const a = nodeAt(i, j), pairs = [[a, nodeAt(i + 1, j)], [a, nodeAt(i, j + 1)]];
    const d = hash(i, j, seed + 1580);
    if (d < .16) pairs.push([a, nodeAt(i + 1, j + 1)]);
    else if (d < .32) pairs.push([nodeAt(i + 1, j), nodeAt(i, j + 1)]);
    return pairs;
  }
  function edgesFrom(i, j) { return pairsFrom(i, j).map(([a, b]) => edge(a, b)).filter(Boolean); }

  // Junctions: a waypoint where three or more roads meet, or two at a sharp
  // angle. The straightest pair through it is the main road; the others are
  // side roads, which stop and give way (right-hand traffic). Each arm's
  // setback is how far from the waypoint its own markings end, clear of the
  // other roads' asphalt (a side road's stop line lies just outside it).
  const junctions = new Map();
  function junctionAt(id) {
    if (junctions.has(id)) return junctions.get(id);
    const [i, j] = id.split(',').map(Number), node = nodeAt(i, j), arms = [];
    if (node) for (let a = i - 1; a <= i; a++) for (let b = j - 1; b <= j; b++) for (const e of edgesFrom(a, b)) {
      const [from, to] = e.id.split('>');
      if (from !== id && to !== id) continue;
      const start = from === id, p = along(e, start ? Math.min(20, e.length) : Math.max(0, e.length - 20)), len = Math.hypot(p.x - node.x, p.z - node.z) || 1;
      arms.push({ e, start, dx: (p.x - node.x) / len, dz: (p.z - node.z) / len, main: false, setback: 0 });
    }
    let result = null;
    if (arms.length >= 3 || (arms.length === 2 && arms[0].dx * arms[1].dx + arms[0].dz * arms[1].dz > -JUNCTION_KINK)) {
      let best = Infinity, pair = null;
      for (let m = 0; m < arms.length; m++) for (let n = m + 1; n < arms.length; n++) {
        const dot = arms[m].dx * arms[n].dx + arms[m].dz * arms[n].dz;
        if (dot < best) { best = dot; pair = [arms[m], arms[n]]; }
      }
      if (arms.length === 2) arms.forEach(arm => { arm.main = true; });
      else if (best < -.77) pair.forEach(arm => { arm.main = true; });
      for (const arm of arms) {
        const others = arms.filter(o => o !== arm);
        let t = 3;
        for (; t < 45; t++) {
          const p = along(arm.e, arm.start ? t : arm.e.length - t), cx = Math.cos(p.heading) * 4.3, cz = -Math.sin(p.heading) * 4.3;
          if (others.every(o => [[p.x, p.z], [p.x + cx, p.z + cz], [p.x - cx, p.z - cz]].every(([x, z]) => distanceNear(o, x, z) > ROAD_HALF + 1))) break;
        }
        // An arm still beside another road 45 m out merges with it rather
        // than meeting it: no stop line there.
        if (t >= 45) arm.main = true;
        arm.setback = t + (arm.main ? 0 : 1);
      }
      result = { id, x: node.x, z: node.z, arms };
    }
    bounded(junctions, 4000); junctions.set(id, result);
    return result;
  }
  // Distance from a point to the first 60 m of a junction arm.
  function distanceNear(arm, x, z) {
    const e = arm.e, p = e.points, n = Math.min(e.count - 1, 6);
    let best = Infinity;
    for (let m = 0; m < n; m++) {
      const k = arm.start ? m : e.count - 2 - m, ax = p[k * 2], az = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, dz = p[k * 2 + 3] - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
    }
    return best;
  }
  // A road's ends: the junction arm at each (null where the road just
  // continues into the next).
  function endsOf(e) {
    if (!e.ends) {
      const [a, b] = e.id.split('>'), arm = (id, start) => junctionAt(id)?.arms.find(o => o.e.id === e.id && o.start === start) || null;
      e.ends = [arm(a, true), arm(b, false)];
    }
    return e.ends;
  }
  // Every road segment within ROAD_REACH of a 96 m square.
  function bucket(bx, bz) {
    const key = `${bx},${bz}`;
    if (buckets.has(key)) return buckets.get(key);
    const x0 = bx * BUCKET - ROAD_REACH, z0 = bz * BUCKET - ROAD_REACH, x1 = (bx + 1) * BUCKET + ROAD_REACH, z1 = (bz + 1) * BUCKET + ROAD_REACH;
    const ci = Math.floor(bx * BUCKET / ROAD_CELL), cj = Math.floor(bz * BUCKET / ROAD_CELL), list = [];
    for (let i = ci - 2; i <= ci + 1; i++) for (let j = cj - 2; j <= cj + 1; j++) for (const e of edgesFrom(i, j)) {
      if (e.box[0] > x1 || e.box[2] < x0 || e.box[1] > z1 || e.box[3] < z0) continue;
      for (let k = 0; k < e.count - 1; k++) {
        const ax = e.points[k * 2], az = e.points[k * 2 + 1], bxx = e.points[k * 2 + 2], bzz = e.points[k * 2 + 3];
        if (Math.max(ax, bxx) < x0 || Math.min(ax, bxx) > x1 || Math.max(az, bzz) < z0 || Math.min(az, bzz) > z1) continue;
        list.push(e, k);
      }
    }
    bounded(buckets, 1500); buckets.set(key, list);
    return list;
  }
  const NONE = { d: 1e4, x: 0, z: 0, heading: 0, level: 0, s: 0, id: null };
  // The nearest road: distance, the nearest point on it, its heading
  // (radians, as the car's), its height there, and how far along it is.
  function roadAt(x, z) {
    const list = bucket(Math.floor(x / BUCKET), Math.floor(z / BUCKET));
    // The nearest road, and the nearest other road (od, olevel: its distance
    // and level there).
    let best = Infinity, be = null, bk = 0, bt = 0, second = Infinity, se = null, sk = 0, st = 0;
    for (let n = 0; n < list.length; n += 2) {
      const e = list[n], k = list[n + 1], p = e.points;
      const ax = p[k * 2], az = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, dz = p[k * 2 + 3] - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const ex = ax + dx * t - x, ez = az + dz * t - z, d2 = ex * ex + ez * ez;
      if (d2 < best) { if (e !== be) { second = best; se = be; sk = bk; st = bt; } best = d2; be = e; bk = k; bt = t; }
      else if (d2 < second && e !== be) { second = d2; se = e; sk = k; st = t; }
    }
    if (!be) return { ...NONE, x, z };
    const p = be.points, dx = p[bk * 2 + 2] - p[bk * 2], dz = p[bk * 2 + 3] - p[bk * 2 + 1];
    // The bridge this point of the road is on (span: under its deck, which
    // reaches 6 m past the fixed points at either end), or whose approach it
    // is on (approach: within 100 m of a deck).
    let span = null, approach = null; const at = bk + bt;
    for (const b of be.bridges) { if (at >= b.i0 - .6 && at < b.i1 + .6) span = b; if (bk >= b.i0 - 10 && bk < b.i1 + 10) approach = b; }
    return { d: Math.sqrt(best), x: p[bk * 2] + dx * bt, z: p[bk * 2 + 1] + dz * bt, heading: Math.atan2(dx, dz),
      level: be.level[bk] + (be.level[bk + 1] - be.level[bk]) * bt, s: (bk + bt) * be.length / (be.count - 1), id: be.id, bridge: span, approach,
      od: Math.sqrt(second), olevel: se ? se.level[sk] + (se.level[sk + 1] - se.level[sk]) * st : 0 };
  }
  // Roads near a point, as polylines (minimap, roadside posts, road maps).
  function roadsNear(x, z, radius) {
    const found = [], seen = new Set();
    const ci = Math.floor(x / ROAD_CELL), cj = Math.floor(z / ROAD_CELL), reach = Math.ceil(radius / ROAD_CELL) + 1;
    for (let i = ci - reach; i <= ci + reach; i++) for (let j = cj - reach; j <= cj + reach; j++) for (const e of edgesFrom(i, j)) {
      if (seen.has(e.id) || e.box[0] > x + radius || e.box[2] < x - radius || e.box[1] > z + radius || e.box[3] < z - radius) continue;
      seen.add(e.id); found.push(e);
    }
    return found;
  }
  // The nearest road out to any radius (roadAt only knows ROAD_REACH):
  // for placing sites beside roads.
  function nearestRoad(x, z, radius) {
    let best = null;
    for (const e of roadsNear(x, z, radius)) for (let k = 0; k < e.count; k++) {
      const d = Math.hypot(e.points[k * 2] - x, e.points[k * 2 + 1] - z);
      if (d < radius && (!best || d < best.d)) {
        const n = Math.min(k, e.count - 2);
        best = { d, x: e.points[k * 2], z: e.points[k * 2 + 1], heading: Math.atan2(e.points[n * 2 + 2] - e.points[n * 2], e.points[n * 2 + 3] - e.points[n * 2 + 1]), level: e.level[k], id: e.id };
      }
    }
    return best;
  }
  // A point s metres along a road and side metres to its left (right if
  // negative; +x is to the left of a car heading +z), with the road's
  // heading there.
  function along(e, s, side = 0) {
    const f = clamp(s / e.length, 0, 1) * (e.count - 1), k = Math.min(Math.floor(f), e.count - 2), t = f - k, p = e.points;
    const dx = p[k * 2 + 2] - p[k * 2], dz = p[k * 2 + 3] - p[k * 2 + 1], heading = Math.atan2(dx, dz);
    return { x: p[k * 2] + dx * t + Math.cos(heading) * side, z: p[k * 2 + 1] + dz * t - Math.sin(heading) * side, heading };
  }
  // A road map for one terrain tile: ROAD_MAP² texels of RGBA. R: distance
  // to the nearest road's centre line (0–12.75 m, 5 cm steps); G: where the
  // centre-line dashes fall along it (the cosine of a 14 m cycle); B: distance
  // to the nearest other road (0–25.5 m); A: how far left of the centre line
  // (±1.6 m, beyond which only the side counts; unlike R it changes evenly
  // across the line, so a thin line drawn from it stays whole). The ground
  // shader paints the asphalt, edges and dashes from it, so every terrain
  // tier shows the roads the physics drives on.
  //
  // Near tiles (near: true) also get a detail map, and leave bridge decks to
  // carry their own markings. R: 1 where the centre line is solid; G: dips
  // where puddles gather (0–1); B: metres outside the nearest junction
  // setback, negative inside the junction (±6.4 m in 5 cm steps; 255 with
  // none near); A: 128, or 255 (0) on a side road's approach whose incoming
  // lane lies left (right) of the centre line.
  function roadMap(x0, z0, size, res = ROAD_MAP, near = true) {
    const n = res * res, texel = size / res, nearest = new Float32Array(n).fill(12.75), other = new Float32Array(n).fill(25.5);
    const phase = new Float32Array(n), side = new Float32Array(n), owner = new Int32Array(n).fill(-1), reach = 25.5 + texel;
    const list = roadsNear(x0 + size / 2, z0 + size / 2, size * .75 + reach);
    list.forEach((e, ei) => {
      const p = e.points, unit = e.length / (e.count - 1);
      for (let k = 0; k < e.count - 1; k++) {
        if (near && e.bridges.some(b => k >= b.i0 && k < b.i1)) continue; // the deck carries its own markings (far tiles paint the road on, as no deck is drawn there)
        const ax = p[k * 2], az = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, dz = p[k * 2 + 3] - az, len2 = dx * dx + dz * dz || 1, len = Math.sqrt(len2);
        const i0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - reach - x0) / texel)), i1 = Math.min(res - 1, Math.ceil((Math.max(ax, ax + dx) + reach - x0) / texel));
        const j0 = Math.max(0, Math.floor((Math.min(az, az + dz) - reach - z0) / texel)), j1 = Math.min(res - 1, Math.ceil((Math.max(az, az + dz) + reach - z0) / texel));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = x0 + (i + .5) * texel, z = z0 + (j + .5) * texel, t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
          const d = Math.hypot(ax + dx * t - x, az + dz * t - z), q = j * res + i;
          if (owner[q] !== ei) {
            if (d >= nearest[q]) { other[q] = Math.min(other[q], d); continue; }
            other[q] = Math.min(other[q], nearest[q]); owner[q] = ei;
          } else if (d >= nearest[q]) continue;
          nearest[q] = d; phase[q] = (k + t) * unit; side[q] = ((x - ax) * dz - (z - az) * dx) / len;
        }
      }
    });
    const map = new Uint8Array(n * 4), info = near ? new Uint8Array(n * 4) : null;
    for (let q = 0; q < n; q++) {
      map[q * 4] = Math.round(Math.min(nearest[q], 12.75) / .05);
      map[q * 4 + 1] = Math.round((Math.cos(phase[q] * Math.PI * 2 / 14) * .5 + .5) * 255);
      map[q * 4 + 2] = Math.round(Math.min(other[q], 25.5) / .1);
      map[q * 4 + 3] = Math.round((clamp(side[q], -1.6, 1.6) / 1.6 * .5 + .5) * 255);
      if (!info) continue;
      info[q * 4 + 2] = 255; info[q * 4 + 3] = 128;
      if (owner[q] < 0) continue;
      const e = list[owner[q]], s = phase[q], f = Math.min(s / e.length, 1) * (e.count - 1), k = Math.min(Math.floor(f), e.count - 2), t = f - k;
      info[q * 4] = Math.round((e.solid[k] + (e.solid[k + 1] - e.solid[k]) * t) * 255);
      info[q * 4 + 1] = Math.round((e.sag[k] + (e.sag[k + 1] - e.sag[k]) * t) * 255);
      // The nearer junction end, if any: metres outside its setback.
      const [a, b] = endsOf(e), fromA = a ? s - a.setback : Infinity, fromB = b ? e.length - b.setback - s : Infinity;
      const from = Math.min(fromA, fromB), arm = fromA <= fromB ? a : b;
      if (from < Infinity) info[q * 4 + 2] = Math.round(clamp(128 + from / .05, 0, 255));
      // Arriving at a side road's start the car travels back along it, with
      // its lane left of the line; arriving at its end, right of it.
      if (arm && !arm.main && from < 40) info[q * 4 + 3] = arm.start ? 255 : 0;
    }
    return { map, info };
  }
  // Work the network out ahead, a little at a time, so a car or plane never
  // waits on routing: returns true once every road near the point is ready.
  function prepare(x, z, radius, budgetMs) {
    const until = performance.now() + budgetMs, ci = Math.floor(x / ROAD_CELL), cj = Math.floor(z / ROAD_CELL), reach = Math.ceil(radius / ROAD_CELL) + 1;
    for (let r = 0; r <= reach; r++) for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
      if (performance.now() > until) return false;
      for (const [a, b] of pairsFrom(i, j)) if (edge(a, b, until) === undefined) return false;
    }
    return true;
  }
  return { roadAt, roadsNear, nearestRoad, along, roadMap, prepare, nodeAt, edgesFrom, junctionAt, endsOf };
}
