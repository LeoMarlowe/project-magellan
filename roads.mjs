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
// Road classes, by how much wider than the standard road (ROAD_HALF either
// side of the line) each is: highways have two lanes each way, dirt tracks
// and lanes are narrower. Distances to a road (roadAt's d, the road maps)
// take that off, as if every road were standard: any road's edge is at
// ROAD_HALF, so whatever keeps clear of roads keeps clear of each by its own
// width.
export const ROAD_EXTRA = { highway: 2.9, road: 0, ring: 0, dirt: -1.5, lane: -.6 };
const LATTICE = 48;      // routing grid spacing, metres
const STEP = 10;         // spacing of the finished road's points
const MAX_GRADE = .11;   // steepest the finished road may climb
const ROUTE_GRADE = .1;  // steepest step a route may take on the lattice: on steeper ground it zigzags, in hairpins
const HIGHWAY_GRADE = .07; // a highway's: gentler still, and climbing costs it more
const TRACK_GRADE = .16;  // a mountain track's: steeper (it is dirt, and climbs to the tops)
const MAX_CUT = 28;      // deepest cutting or highest embankment a road may need
const CREST_RADIUS = 650, RAMP_GRADE = .08; // a bridge approach's rounded crest (metres) and its steepest grade
const BUCKET = 96;       // road lookups are listed per 96 m square (a terrain chunk)
const NO_PASSING_BEND = 110, NO_PASSING_CREST = 900; // radii (m): tighter bends and crests get a solid centre line
const RING = 16;             // a roundabout's radius (to the middle of its lane)
const JUNCTION_KINK = .82;   // two roads meeting straighter than about 145° just continue (a junction otherwise)
export const ROAD_REACH = 80; // roadAt is exact within this distance of a road
export const ROAD_MAP = 128;  // road map texels per terrain tile side

// ground(x, z): the natural land height; mountainAt(x, z): 0–1;
// wet(x, z): true over lakes and seas; riverCost(x, z): extra cost near a
// river, so roads cross rivers where they are narrow rather than follow them.
// Every step a route may take on the lattice: each direction (dx, dz) with
// both up to 3 cells and no common factor, so 32 directions.
const gcd = (a, b) => b ? gcd(b, a % b) : a;
const MOVES = [];
for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if ((dx || dz) && gcd(Math.abs(dx), Math.abs(dz)) === 1) MOVES.push([dx, dz]);

export function createRoads({ seed, ground, mountainAt, woodlandAt = () => 0, wet, riverCost = () => 0, riverAt = () => null }) {
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
      const score = mountainAt(x, z) + slope * 6 + (wet(x, z) ? 100 : 0);
      if (!best || score < best.score) best = { x, z, score };
    }
    const node = best.score < 3 ? { id: key, i, j, x: best.x, z: best.z, y: ground(best.x, best.z) } : null;
    bounded(nodes, 4000); nodes.set(key, node);
    return node;
  }

  // Cheapest path on a lattice: distance, with climbing (grade squared),
  // mountains and water made expensive, so routes prefer gentle open ground.
  // No step may climb more than 10%: where the land is steeper a route
  // climbs across the slope, in zigzags that become hairpin bends. Its moves
  // reach up to three cells, so it can cross a slope at a shallow angle.
  // A generator: it pauses every few dozen cells so the work can be spread
  // over frames (see edge).
  function* route(a, b, limit = ROUTE_GRADE, climb = 70) {
    // Room around the line between them, enough to zigzag up the height between.
    const span = Math.hypot(b.x - a.x, b.z - a.z), margin = Math.max(clamp(span * .4, 300, 600), Math.min(800, Math.abs((b.y ?? 0) - (a.y ?? 0)) / limit * .4));
    const x0 = Math.min(a.x, b.x) - margin, z0 = Math.min(a.z, b.z) - margin;
    const nx = Math.ceil((Math.max(a.x, b.x) + margin - x0) / LATTICE) + 1, nz = Math.ceil((Math.max(a.z, b.z) + margin - z0) / LATTICE) + 1;
    const n = nx * nz, heights = new Float32Array(n).fill(NaN), penalty = new Float32Array(n).fill(NaN);
    const at = k => {
      if (Number.isNaN(heights[k])) {
        const x = x0 + (k % nx) * LATTICE, z = z0 + Math.floor(k / nx) * LATTICE;
        heights[k] = ground(x, z); penalty[k] = wet(x, z) ? 400 : 1 + .8 * mountainAt(x, z) + riverCost(x, z);
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
    const moves = MOVES;
    for (let visited = 1; heap.length; visited++) {
      if (visited % 24 === 0) yield;
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
        if (Math.abs(grade) > limit) continue;
        // On a mountainside a long step can leap a gully or a spur: a track
        // checks the ground halfway along too.
        if (limit > ROUTE_GRADE && Math.max(Math.abs(dx), Math.abs(dz)) > 1) {
          const middle = ground(x0 + (kx + dx / 2) * LATTICE, z0 + (kz + dz / 2) * LATTICE);
          if (Math.abs(middle - (hk + heights[m]) / 2) > length * limit * .25) continue;
        }
        const step = length * (1 + climb * grade * grade) * (penalty[k] + penalty[m]) / 2;
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
  // A generator, a slice at a time like the routing (yield* finish(…)).
  function* finish(id, a, b, path, kind) {
    // A highway first evens out the lattice's zigzags into long sweeping curves.
    if (kind === 'highway') for (let pass = 0; pass < 3; pass++) path = path.map((p, k) => k === 0 || k === path.length - 1 ? p : [(path[k - 1][0] + 2 * p[0] + path[k + 1][0]) / 4, (path[k - 1][1] + 2 * p[1] + path[k + 1][1]) / 4]);
    // (A track's hairpins stay tight: rounding them more would cut across its slope.)
    for (let pass = 0; pass < (kind === 'track' ? 2 : 4); pass++) {
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
    if (total > (kind === 'track' ? Math.max(Math.hypot(b.x - a.x, b.z - a.z) * 4.5, Math.abs(b.y - a.y) * 16) : Math.hypot(b.x - a.x, b.z - a.z) * 2.4)) return null; // a long detour: no road here (a track may wind up its mountain)
    const points = new Float32Array(count * 2), level = new Float32Array(count), raw = new Float32Array(count);
    for (let i = 0, k = 0; i < count; i++) {
      const s = total * i / (count - 1);
      while (k < path.length - 2 && lengths[k + 1] < s) k++;
      const t = clamp((s - lengths[k]) / (lengths[k + 1] - lengths[k] || 1), 0, 1);
      points[i * 2] = path[k][0] + (path[k + 1][0] - path[k][0]) * t; points[i * 2 + 1] = path[k][1] + (path[k + 1][1] - path[k][1]) * t;
      raw[i] = ground(points[i * 2], points[i * 2 + 1]);
      if (i % 64 === 63) yield;
    }
    for (let i = 0; i < count; i++) {
      let sum = 0, weight = 0;
      const span = kind === 'track' ? 2 : 6;
      for (let k = Math.max(0, i - span); k <= Math.min(count - 1, i + span); k++) { const w = span + 1 - Math.abs(k - i); sum += raw[k] * w; weight += w; }
      level[i] = sum / weight;
    }
    level[0] = a.y; level[count - 1] = b.y;
    yield;
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
    const rise = (kind === 'highway' ? HIGHWAY_GRADE : kind === 'track' ? TRACK_GRADE + .01 : MAX_GRADE) * total / (count - 1);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < count; i++) if (!fixed[i]) level[i] = clamp(level[i], level[i - 1] - rise, level[i - 1] + rise);
      for (let i = count - 2; i >= 0; i--) if (!fixed[i]) level[i] = clamp(level[i], level[i + 1] - rise, level[i + 1] + rise);
    }
    // Where a junction close by cut a crest short, ease the kink it leaves
    // (the deck's last point at either end, over dry land, may ease too).
    // No deck eases, its own or a neighbour's close by on the same road.
    const onDeck = new Uint8Array(count);
    for (const b of bridges) onDeck.fill(1, b.i0 + 1, b.i1);
    for (let pass = 0; pass < 8; pass++) for (const b of bridges) for (let i = Math.max(1, b.i0 - 14); i <= Math.min(count - 2, b.i1 + 14); i++) {
      if (onDeck[i]) continue;
      level[i] = (level[i - 1] + 2 * level[i] + level[i + 1]) / 4;
    }
    let cut = 0, steepest = 0;
    for (let i = 0; i < count; i++) { cut = Math.max(cut, Math.abs(level[i] - raw[i])); if (i) steepest = Math.max(steepest, Math.abs(level[i] - level[i - 1])); }
    if (cut > (kind === 'track' ? 35 : MAX_CUT)) return null; // it would need a tunnel or a viaduct
    if (steepest > rise * 1.1) return null; // its ends are too far apart in height to join at a drivable grade
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < count; i++) { x0 = Math.min(x0, points[i * 2]); x1 = Math.max(x1, points[i * 2]); z0 = Math.min(z0, points[i * 2 + 1]); z1 = Math.max(z1, points[i * 2 + 1]); }
    yield;
    // A country road through forest or mountains is a dirt track.
    if (kind === 'road') {
      let wild = 0;
      for (let i = 0; i < count; i++) if (woodlandAt(points[i * 2], points[i * 2 + 1]) > .55 || mountainAt(points[i * 2], points[i * 2 + 1]) > .4) wild++;
      if (wild / count > .55) kind = 'dirt';
    }
    if (kind === 'track') kind = 'dirt';
    return { id, points, level, count, length: total, bridges, box: [x0, z0, x1, z1], kind, extra: ROAD_EXTRA[kind], ...profile(points, level, count, unit) };
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

  // Highways link every third row and column of waypoints (a grid about
  // 4 km across); where one can't be built a country road takes its place.
  const third = n => (n % 3 + 3) % 3 === 0;
  const highwayBetween = (a, b) => (b.i === a.i + 1 && b.j === a.j && third(a.j)) || (b.i === a.i && b.j === a.j + 1 && third(a.i));
  function* build(id, a, b) {
    if (highwayBetween(a, b)) {
      const path = yield* route(a, b, HIGHWAY_GRADE, 150); yield;
      const highway = path && (yield* finish(id, a, b, path, 'highway'));
      if (highway) return highway;
    }
    const path = yield* route(a, b); yield;
    return path && (yield* finish(id, a, b, path, 'road'));
  }
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
    if (id.startsWith('spur:')) return spurs.get(id)?.tee || null;
    if (id.startsWith('track:')) return tracks.get(id)?.tee || null;
    if (id.startsWith('ring:')) return null; // a roundabout's ring belongs to its junction
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
          const p = along(arm.e, arm.start ? t : arm.e.length - t), w = 4.3 + arm.e.extra, cx = Math.cos(p.heading) * w, cz = -Math.sin(p.heading) * w;
          if (others.every(o => [[p.x, p.z], [p.x + cx, p.z + cz], [p.x - cx, p.z - cz]].every(([x, z]) => distanceNear(o, x, z) > ROAD_HALF + o.e.extra + 1))) break;
        }
        // An arm still beside another road 45 m out merges with it rather
        // than meeting it: no stop line there.
        if (t >= 45) arm.main = true;
        arm.setback = t + (arm.main ? 0 : 1);
      }
      result = { id, x: node.x, z: node.z, arms };
      // Now and then a busy junction (four roads or more) is a roundabout:
      // every road gives way where it meets the ring, round a grass island.
      if (arms.length >= 4 && hash(i, j, seed + 1590) < .2) {
        result.ring = RING;
        for (const arm of arms) { arm.main = false; arm.ring = true; arm.setback = Math.max(arm.setback, RING + ROAD_HALF + arm.e.extra + 2); arm.island = { x: node.x, z: node.z, r: RING - ROAD_HALF - .3 }; }
      }
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
    if (e.ring) return [null, null];
    if (e.spur) return [e.tee.arms[0], null]; // a T junction where it leaves its road; a dead end
    if (!e.ends) {
      const [a, b] = e.id.split('>'), arm = (id, start) => junctionAt(id)?.arms.find(o => o.e.id === e.id && o.start === start) || null;
      e.ends = [arm(a, true), arm(b, false)];
    }
    return e.ends;
  }
  // Every road segment within ROAD_REACH of a 96 m square: the network's
  // (network: true), or with the spurs off it too.
  function bucket(bx, bz, network = false) {
    const key = `${bx},${bz}${network ? 'n' : ''}`;
    if (buckets.has(key)) return buckets.get(key);
    const x0 = bx * BUCKET - ROAD_REACH, z0 = bz * BUCKET - ROAD_REACH, x1 = (bx + 1) * BUCKET + ROAD_REACH, z1 = (bz + 1) * BUCKET + ROAD_REACH;
    const ci = Math.floor(bx * BUCKET / ROAD_CELL), cj = Math.floor(bz * BUCKET / ROAD_CELL), list = [], candidates = [];
    for (let i = ci - 2; i <= ci + 1; i++) for (let j = cj - 2; j <= cj + 1; j++) candidates.push(...edgesFrom(i, j));
    if (!network) candidates.push(...spursIn(x0, z0, x1, z1), ...ringsIn(x0, z0, x1, z1));
    for (const e of candidates) {
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
  const NONE = { d: 1e4, kind: null, extra: 0, x: 0, z: 0, heading: 0, level: 0, s: 0, id: null };
  // The nearest road: distance, the nearest point on it, its heading
  // (radians, as the car's), its height there, and how far along it is.
  function roadAt(x, z, network = false) {
    const list = bucket(Math.floor(x / BUCKET), Math.floor(z / BUCKET), network);
    // The nearest road, and the nearest other road (od, olevel: its distance
    // and level there).
    let best = Infinity, be = null, bk = 0, bt = 0, second = Infinity, se = null, sk = 0, st = 0;
    for (let n = 0; n < list.length; n += 2) {
      const e = list[n], k = list[n + 1], p = e.points;
      const ax = p[k * 2], az = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, dz = p[k * 2 + 3] - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const ex = ax + dx * t - x, ez = az + dz * t - z, d = Math.sqrt(ex * ex + ez * ez) - e.extra;
      if (d < best) { if (e !== be) { second = best; se = be; sk = bk; st = bt; } best = d; be = e; bk = k; bt = t; }
      else if (d < second && e !== be) { second = d; se = e; sk = k; st = t; }
    }
    if (!be) return { ...NONE, x, z };
    const p = be.points, dx = p[bk * 2 + 2] - p[bk * 2], dz = p[bk * 2 + 3] - p[bk * 2 + 1];
    // The bridge this point of the road is on (span: under its deck, which
    // reaches 6 m past the fixed points at either end), or whose approach it
    // is on (approach: within 100 m of a deck).
    let span = null, approach = null; const at = bk + bt;
    for (const b of be.bridges) { if (at >= b.i0 - .6 && at < b.i1 + .6) span = b; if (bk >= b.i0 - 10 && bk < b.i1 + 10) approach = b; }
    return { d: Math.max(0, best), kind: be.kind, extra: be.extra, x: p[bk * 2] + dx * bt, z: p[bk * 2 + 1] + dz * bt, heading: Math.atan2(dx, dz),
      level: be.level[bk] + (be.level[bk + 1] - be.level[bk]) * bt, s: (bk + bt) * be.length / (be.count - 1), id: be.id, slipway: Boolean(be.spur?.slipway), bridge: span, approach,
      od: Math.max(0, second), olevel: se ? se.level[sk] + (se.level[sk + 1] - se.level[sk]) * st : 0 };
  }
  // Roads near a point, as polylines (minimap, roadside posts, road maps),
  // with the spurs off them unless network is set.
  function roadsNear(x, z, radius, network = false) {
    const found = [], seen = new Set();
    const ci = Math.floor(x / ROAD_CELL), cj = Math.floor(z / ROAD_CELL), reach = Math.ceil(radius / ROAD_CELL) + 1;
    for (let i = ci - reach; i <= ci + reach; i++) for (let j = cj - reach; j <= cj + reach; j++) for (const e of edgesFrom(i, j)) {
      if (seen.has(e.id) || e.box[0] > x + radius || e.box[2] < x - radius || e.box[1] > z + radius || e.box[3] < z - radius) continue;
      seen.add(e.id); found.push(e);
    }
    return network ? found : found.concat(spursIn(x - radius, z - radius, x + radius, z + radius), ringsIn(x - radius, z - radius, x + radius, z + radius));
  }
  // The nearest network road out to any radius (roadAt only knows
  // ROAD_REACH): for placing sites beside roads.
  function nearestRoad(x, z, radius) {
    let best = null;
    for (const e of roadsNear(x, z, radius, true)) for (let k = 0; k < e.count; k++) {
      const d = Math.hypot(e.points[k * 2] - x, e.points[k * 2 + 1] - z) - e.extra;
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
  // Spur roads: short dead ends off the network (world.mjs says where: to a
  // camp or lookout beside a road, or down into a lake as a slipway). Each
  // leaves its road square to it at a T junction, with a stop line, then
  // curves to its end. source(x0, z0, x1, z1) lists the spurs whose reach
  // may meet that rectangle: { id, from: { x, z } near the road, to: { x, z },
  // water: the lake's level for a slipway }.
  let spurSource = null;
  const spurs = new Map();
  function setSpurs(source) { spurSource = source; spurs.clear(); buckets.clear(); }
  function spursIn(x0, z0, x1, z1) {
    const found = [];
    // Mountain tracks reach out of their own cells by up to a cell.
    for (let i = Math.floor(x0 / ROAD_CELL) - 1; i <= Math.floor(x1 / ROAD_CELL) + 1; i++) for (let j = Math.floor(z0 / ROAD_CELL) - 1; j <= Math.floor(z1 / ROAD_CELL) + 1; j++) {
      const e = trackEdge(i, j);
      if (e && e.box[0] <= x1 && e.box[2] >= x0 && e.box[1] <= z1 && e.box[3] >= z0) found.push(e);
    }
    if (spurSource) for (const spec of spurSource(x0, z0, x1, z1)) {
      const e = spurEdge(spec);
      if (e && e.box[0] <= x1 && e.box[2] >= x0 && e.box[1] <= z1 && e.box[3] >= z0) found.push(e);
    }
    return found;
  }
  function spurEdge(spec) {
    if (spurs.has(spec.id)) return spurs.get(spec.id);
    let result = null;
    const at = roadAt(spec.from.x, spec.from.z, true), parent = at.id && roadsNear(at.x, at.z, 1, true).find(e => e.id === at.id);
    if (parent && at.d < 90) {
      const unit = parent.length / (parent.count - 1), [a, b] = endsOf(parent);
      // Clear of the junctions at its road's ends, and of bridges.
      if (at.s > (a ? a.setback : 0) + 30 && at.s < parent.length - (b ? b.setback : 0) - 30 && !parent.bridges.some(g => at.s > (g.i0 - 12) * unit && at.s < (g.i1 + 12) * unit)) result = buildSpur(spec, parent, at);
    }
    bounded(spurs, 2000); spurs.set(spec.id, result);
    return result;
  }
  function buildSpur(spec, parent, at) {
    const tx = spec.to.x, tz = spec.to.z, span = Math.hypot(tx - at.x, tz - at.z);
    if (span < 20) return null;
    // A curve that leaves the road square to it, toward the target's side.
    const lx = Math.cos(at.heading), lz = -Math.sin(at.heading), side = Math.sign((tx - at.x) * lx + (tz - at.z) * lz) || 1, c = Math.min(span * .45, 30);
    const bx = at.x + lx * side * c, bz = at.z + lz * side * c, dense = [], lengths = [0];
    for (let i = 0; i <= 64; i++) { const t = i / 64, u = 1 - t; dense.push([u * u * at.x + 2 * u * t * bx + t * t * tx, u * u * at.z + 2 * u * t * bz + t * t * tz]); }
    for (let i = 1; i <= 64; i++) lengths.push(lengths[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const total = lengths[64], count = Math.max(4, Math.round(total / 6) + 1), unit = total / (count - 1);
    const points = new Float32Array(count * 2), raw = new Float32Array(count), level = new Float32Array(count);
    for (let i = 0, k = 0; i < count; i++) {
      const s = total * i / (count - 1);
      while (k < 63 && lengths[k + 1] < s) k++;
      const t = clamp((s - lengths[k]) / (lengths[k + 1] - lengths[k] || 1), 0, 1);
      points[i * 2] = dense[k][0] + (dense[k + 1][0] - dense[k][0]) * t; points[i * 2 + 1] = dense[k][1] + (dense[k + 1][1] - dense[k][1]) * t;
      const x = points[i * 2], z = points[i * 2 + 1];
      // Nowhere near another road or a river; and only a slipway goes into water.
      if (i * unit > 14 && roadAt(x, z, true).d < 10) return null;
      const river = riverAt(x, z); if (river && river.d < river.width / 2 + 6) return null;
      if (spec.water == null && wet(x, z)) return null;
      raw[i] = ground(x, z);
    }
    // Its own smoothed profile from its road's level, at most 11% steep; a
    // slipway then runs on down at 14% from just above the water.
    for (let i = 0; i < count; i++) { let sum = 0, n = 0; for (let k = Math.max(0, i - 2); k <= Math.min(count - 1, i + 2); k++) { sum += raw[k]; n++; } level[i] = sum / n; }
    level[0] = at.level;
    let shore = -1;
    for (let i = 1; i < count; i++) {
      level[i] = clamp(level[i], level[i - 1] - MAX_GRADE * unit, level[i - 1] + MAX_GRADE * unit);
      if (spec.water != null && shore < 0 && wet(points[i * 2], points[i * 2 + 1])) shore = i;
      if (shore >= 0) level[i] = Math.max(spec.water - 2.5, Math.min(level[i], spec.water + .25 - (i - shore) * unit * .14));
    }
    if (spec.water != null && shore < 0) return null;
    // A high bank above the water: the lane cuts down through it to meet the
    // slipway's top, rather than dropping off the bank at the shore.
    if (shore > 0) for (let i = shore - 1; i > 0; i--) level[i] = Math.min(level[i], level[i + 1] + MAX_GRADE * unit);
    for (let i = 1; i < count; i++) if (Math.abs(level[i] - level[i - 1]) > unit * .14 + 1e-6) return null; // too far down to the water
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < count; i++) { x0 = Math.min(x0, points[i * 2]); x1 = Math.max(x1, points[i * 2]); z0 = Math.min(z0, points[i * 2 + 1]); z1 = Math.max(z1, points[i * 2 + 1]); }
    const kind = spec.kind || 'lane', e = { id: spec.id, points, level, count, length: total, bridges: [], box: [x0, z0, x1, z1], kind, extra: ROAD_EXTRA[kind], ...profile(points, level, count, unit), spur: { parent: parent.id, s: at.s, side, slipway: spec.water != null } };
    e.solid.fill(0); // a quiet lane: a dashed centre line throughout
    return withTee(e, parent, at);
  }
  // A spur's T junction: the spur stops (a side road) and the road it leaves runs on through.
  function withTee(e, parent, at) {
    const points = e.points;
    let t = 3;
    for (; t < 30; t++) {
      const p = along(e, t), cx = Math.cos(p.heading) * 4.3, cz = -Math.sin(p.heading) * 4.3;
      if ([[p.x, p.z], [p.x + cx, p.z + cz], [p.x - cx, p.z - cz]].every(([x, z]) => roadAt(x, z, true).d > ROAD_HALF + 1)) break;
    }
    const hx = Math.sin(at.heading), hz = Math.cos(at.heading), dx = points[2] - points[0], dz = points[3] - points[1], len = Math.hypot(dx, dz) || 1;
    e.tee = { id: e.id, tee: true, x: at.x, z: at.z, arms: [{ e, start: true, dx: dx / len, dz: dz / len, main: false, setback: t + 1 },
      { e: parent, start: true, dx: hx, dz: hz, main: true, setback: 0 }, { e: parent, start: false, dx: -hx, dz: -hz, main: true, setback: 0 }] };
    return e;
  }
  // Mountain tracks: in about half the cells with high ground, a dirt track
  // climbs from the nearest road to the highest spot flat enough to end on
  // that it can reach (of the two highest, 200 m apart), in hairpins (up
  // to 16%), above the snow line where the land allows.
  // Routed a slice at a time ahead of the car (prepare), like the network.
  const tracks = new Map();
  function summitOf(i, j) {
    if (hash(i, j, seed + 1620) > .5) return null;
    const spots = [], tops = [];
    for (let u = .1; u <= .9; u += .05) for (let v = .1; v <= .9; v += .05) {
      const x = (i + u) * ROAD_CELL, z = (j + v) * ROAD_CELL;
      if (mountainAt(x, z) < .45) continue;
      const y = ground(x, z);
      if (y > 140) spots.push({ x, z, y });
    }
    // Highest first, flat enough to end on, and apart.
    for (const spot of spots.sort((a, b) => b.y - a.y)) {
      if (tops.length >= 2) break;
      if (tops.some(t => Math.hypot(t.x - spot.x, t.z - spot.z) < 200) || wet(spot.x, spot.z)) continue;
      const { x, z } = spot;
      if (Math.hypot(ground(x + 20, z) - ground(x - 20, z), ground(x, z + 20) - ground(x, z - 20)) / 40 < .35) tops.push(spot);
    }
    return tops.length ? tops : null;
  }
  function* buildTrack(id, i, j) {
    const tops = summitOf(i, j), summit0 = tops?.[0];
    yield;
    if (!summit0) return null;
    // From the nearest point of the roads around its cell, clear of their junctions and bridges.
    let start = null, best = Infinity;
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
      for (const e of edgesFrom(a, b)) {
        // (Its junctions are only worked out for a road that comes near enough.)
        const [x0, z0, x1, z1] = e.box, near = Math.hypot(Math.max(x0 - summit0.x, 0, summit0.x - x1), Math.max(z0 - summit0.z, 0, summit0.z - z1));
        if (near >= Math.min(best, 2200)) continue;
        const unit = e.length / (e.count - 1);
        let ends = null;
        for (let k = 0; k < e.count; k++) {
          const d = Math.hypot(e.points[k * 2] - summit0.x, e.points[k * 2 + 1] - summit0.z), s = k * unit;
          if (d >= best || d >= 2200) continue;
          const [ea, eb] = ends ??= endsOf(e);
          if (s > (ea ? ea.setback : 0) + 40 && s < e.length - (eb ? eb.setback : 0) - 40 && !e.bridges.some(g => s > (g.i0 - 12) * unit && s < (g.i1 + 12) * unit)) {
            best = d; const p = along(e, s); start = { parent: e, at: { ...p, s, level: e.level[k], id: e.id } };
          }
        }
        yield;
      }
      yield;
    }
    if (!start) return null;
    const a = { x: start.at.x, z: start.at.z, y: start.at.level };
    let e = null, summit = null;
    for (const top of tops) {
      const path = yield* route(a, top, TRACK_GRADE, 40);
      yield;
      e = path && (yield* finish(id, a, top, path, 'track'));
      if (e) { summit = top; break; }
    }
    if (!e) return null;
    const lx = Math.cos(start.at.heading), lz = -Math.sin(start.at.heading);
    e.spur = { parent: start.parent.id, s: start.at.s, side: Math.sign((summit.x - a.x) * lx + (summit.z - a.z) * lz) || 1, slipway: false, track: true };
    return withTee(e, start.parent, start.at);
  }
  function trackEdge(i, j, until = Infinity) {
    const id = `track:${i},${j}`;
    if (tracks.has(id)) return tracks.get(id);
    let work = building.get(id);
    if (!work) { bounded(building, 50); building.set(id, work = buildTrack(id, i, j)); }
    for (let step = work.next(); ; step = work.next()) {
      if (step.done) { building.delete(id); bounded(tracks, 2000); tracks.set(id, step.value); return step.value; }
      if (performance.now() > until) return undefined;
    }
  }
  // Roundabouts: each ring is a closed road of its own, level with its junction.
  function ringsIn(x0, z0, x1, z1) {
    const found = [];
    for (let i = Math.floor((x0 - 40) / ROAD_CELL); i <= Math.floor((x1 + 40) / ROAD_CELL); i++) for (let j = Math.floor((z0 - 40) / ROAD_CELL); j <= Math.floor((z1 + 40) / ROAD_CELL); j++) {
      const junction = nodeAt(i, j) && junctionAt(`${i},${j}`);
      if (!junction?.ring || junction.x + RING < x0 - ROAD_REACH || junction.x - RING > x1 + ROAD_REACH || junction.z + RING < z0 - ROAD_REACH || junction.z - RING > z1 + ROAD_REACH) continue;
      if (!junction.ringEdge) {
        const count = 33, points = new Float32Array(count * 2), y = nodeAt(i, j).y;
        // Anticlockwise from above: traffic keeps right round it.
        for (let k = 0; k < count; k++) { const a = -k / (count - 1) * Math.PI * 2; points[k * 2] = junction.x + Math.sin(a) * RING; points[k * 2 + 1] = junction.z + Math.cos(a) * RING; }
        const length = 2 * Math.PI * RING, level = new Float32Array(count).fill(y);
        junction.ringEdge = { id: `ring:${junction.id}`, kind: 'ring', extra: 0, points, level, count, length, bridges: [], box: [junction.x - RING, junction.z - RING, junction.x + RING, junction.z + RING], ...profile(points, level, count, length / (count - 1)), ring: junction };
        junction.ringEdge.solid.fill(0); junction.ringEdge.tees = [];
      }
      found.push(junction.ringEdge);
    }
    return found;
  }
  // Where spurs leave a road (its T junctions): how far along, for its markings.
  function teesOf(e) {
    if (!e.tees) e.tees = e.spur ? [] : spursIn(e.box[0] - 10, e.box[1] - 10, e.box[2] + 10, e.box[3] + 10).filter(o => o.spur.parent === e.id).map(o => o.spur.s);
    return e.tees;
  }

  // A road map for one terrain tile: ROAD_MAP² texels of RGBA. R: distance
  // to the nearest road (0–12.75 m, 5 cm steps, as if every road were
  // standard width: see ROAD_EXTRA); G: where the centre-line dashes fall
  // along it (the cosine of a 14 m cycle); B: distance to the nearest other
  // road (0–25.5 m); A: how far left of the centre line (±4 m, beyond which
  // only the side counts; unlike R it changes evenly across the line, so a
  // thin line drawn from it stays whole). The ground shader paints the
  // asphalt, edges and dashes from it, so every terrain tier shows the roads
  // the physics drives on.
  //
  // Each tile also gets a detail map (and near tiles, near: true, leave
  // bridge decks to carry their own markings). R: the road's kind and centre
  // line: 0 dashed, 64 solid, 128 a highway (a solid double line, and lanes),
  // 192 none (a roundabout's ring), 255 a dirt track; G: dips
  // where puddles gather (0–1); B: metres outside the nearest junction
  // setback, negative inside the junction (±6.4 m in 5 cm steps; 255 with
  // none near); A: 128, or 255 (0) on a side road's approach whose incoming
  // lane lies left (right) of the centre line, 200 (55) where it gives way
  // to a roundabout.
  function roadMap(x0, z0, size, res = ROAD_MAP, near = true) {
    const n = res * res, texel = size / res, nearest = new Float32Array(n).fill(12.75), other = new Float32Array(n).fill(25.5);
    const phase = new Float32Array(n), side = new Float32Array(n), owner = new Int32Array(n).fill(-1), reach = 25.5 + texel;
    const list = roadsNear(x0 + size / 2, z0 + size / 2, size * .75 + reach);
    list.forEach((e, ei) => {
      const p = e.points, unit = e.length / (e.count - 1), islands = endsOf(e).filter(arm => arm?.island).map(arm => arm.island);
      for (let k = 0; k < e.count - 1; k++) {
        if (near && e.bridges.some(b => k >= b.i0 && k < b.i1)) continue; // the deck carries its own markings (far tiles paint the road on, as no deck is drawn there)
        const ax = p[k * 2], az = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, dz = p[k * 2 + 3] - az, len2 = dx * dx + dz * dz || 1, len = Math.sqrt(len2);
        const i0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - reach - x0) / texel)), i1 = Math.min(res - 1, Math.ceil((Math.max(ax, ax + dx) + reach - x0) / texel));
        const j0 = Math.max(0, Math.floor((Math.min(az, az + dz) - reach - z0) / texel)), j1 = Math.min(res - 1, Math.ceil((Math.max(az, az + dz) + reach - z0) / texel));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = x0 + (i + .5) * texel, z = z0 + (j + .5) * texel, t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
          if (islands.some(o => (x - o.x) ** 2 + (z - o.z) ** 2 < o.r * o.r)) continue;
          const d = Math.hypot(ax + dx * t - x, az + dz * t - z) - e.extra, q = j * res + i;
          if (owner[q] !== ei) {
            if (d >= nearest[q]) { other[q] = Math.min(other[q], d); continue; }
            other[q] = Math.min(other[q], nearest[q]); owner[q] = ei;
          } else if (d >= nearest[q]) continue;
          nearest[q] = d; phase[q] = (k + t) * unit; side[q] = ((x - ax) * dz - (z - az) * dx) / len;
        }
      }
    });
    const map = new Uint8Array(n * 4), info = new Uint8Array(n * 4);
    for (let q = 0; q < n; q++) {
      map[q * 4] = Math.round(clamp(nearest[q], 0, 12.75) / .05);
      map[q * 4 + 1] = Math.round((Math.cos(phase[q] * Math.PI * 2 / 14) * .5 + .5) * 255);
      map[q * 4 + 2] = Math.round(clamp(other[q], 0, 25.5) / .1);
      map[q * 4 + 3] = Math.round((clamp(side[q], -4, 4) / 4 * .5 + .5) * 255);
      info[q * 4 + 2] = 255; info[q * 4 + 3] = 128;
      if (owner[q] < 0) continue;
      const e = list[owner[q]], s = phase[q], f = Math.min(s / e.length, 1) * (e.count - 1), k = Math.min(Math.floor(f), e.count - 2), t = f - k;
      if (e.ring) { info[q * 4] = 192; info[q * 4 + 2] = 0; continue; } // all junction: no centre line, rounded into its roads
      info[q * 4] = e.kind === 'dirt' ? 255 : e.kind === 'highway' ? 128 : Math.round((e.solid[k] + (e.solid[k + 1] - e.solid[k]) * t) * 64);
      info[q * 4 + 1] = Math.round((e.sag[k] + (e.sag[k + 1] - e.sag[k]) * t) * 255);
      // The nearer junction end, if any: metres outside its setback.
      const [a, b] = endsOf(e), fromA = a ? s - a.setback : Infinity, fromB = b ? e.length - b.setback - s : Infinity;
      const ends = Math.min(fromA, fromB), arm = fromA <= fromB ? a : b;
      let from = ends;
      for (const tee of teesOf(e)) from = Math.min(from, Math.abs(s - tee) - ROAD_HALF - 3);
      if (from < Infinity) info[q * 4 + 2] = Math.round(clamp(128 + from / .05, 0, 255));
      // Arriving at a side road's start the car travels back along it, with
      // its lane left of the line; arriving at its end, right of it.
      // A roundabout's entries give way (a dashed line, flagged nearer 128).
      if (arm && !arm.main && ends < 40 && from === ends) info[q * 4 + 3] = arm.ring ? (arm.start ? 200 : 55) : arm.start ? 255 : 0;
    }
    return { map, info };
  }
  // Work the network out ahead, a little at a time, so a car or plane never
  // waits on routing: returns true once every road near the point is ready.
  function prepare(x, z, radius, budgetMs) {
    const until = performance.now() + budgetMs, ci = Math.floor(x / ROAD_CELL), cj = Math.floor(z / ROAD_CELL), reach = Math.ceil(radius / ROAD_CELL) + 1;
    // (A ring further than the tracks below need, so the junctions they
    // start beside have all their roads.)
    for (let r = 0; r <= reach + 1; r++) for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
      if (performance.now() > until) return false;
      for (const [a, b] of pairsFrom(i, j)) if (edge(a, b, until) === undefined) return false;
    }
    // Then the mountain tracks, nearest first, within the roads (and
    // junctions) already worked out. A road lookup asks for the tracks of the
    // cells around its own (a track reaches out of its cell), so they go a
    // cell further than a lookup in the radius can reach; otherwise one far
    // out (a distant landmark's ground) routes a track on the spot.
    for (let r = 0; r < reach; r++) for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
      if (performance.now() > until || trackEdge(i, j, until) === undefined) return false;
    }
    return true;
  }
  return { roadAt, networkAt: (x, z) => roadAt(x, z, true), roadsNear, nearestRoad, along, roadMap, prepare, nodeAt, edgesFrom, junctionAt, endsOf, setSpurs };
}
