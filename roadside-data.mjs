// Roadside furniture, built in the worker for each near chunk: white marker
// posts with reflectors, guardrails on tight bends and high embankments,
// chevron boards round the outside of the sharpest bends, stop signs on side
// roads and a fingerpost at each junction. Everything is placed from the
// road network alone, so neighbouring chunks agree, and each piece belongs
// to the chunk it stands in. It draws as one vertex-coloured mesh per chunk,
// in world space, except the signs: each is its own small piece (positions
// from its foot), so a car can knock it over. Reflective faces are marked to
// shine back in the headlights. Guardrails and signs are also obstacles.
import { CHUNK } from './world.mjs?v=roadside-1';

const RAIL = [.42, .45, .47], STEEL = [.24, .25, .26], WHITE = [.78, .77, .72], BLACK = [.02, .02, .02], AMBER = [.92, .42, .04], RED = [.55, .02, .02];
const YELLOW = [.86, .6, .03], BOARD = [.8, .8, .76];
const TIGHT = 1 / 170, SHARP = 1 / 110; // bend curvature (1/m) for guardrails, and for chevrons too

export function buildRoadside(world, terrain, cx, cz) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK, mine = (x, z) => x >= x0 && x < x0 + CHUNK && z >= z0 && z < z0 + CHUNK;
  const parts = () => ({ position: [], normal: [], color: [], retro: [], groundDelta: [] });
  const fixed = parts(), signParts = parts(), signs = [], obstacles = [];
  let out = fixed, origin = [0, 0, 0];
  // Distant terrain is coarser: each piece rides with the ground under its base.
  let delta = 0;
  const rest = (x, z) => { delta = terrain.coarseSample(x, z).height - world.surface(x, z); };
  const quad = (a, b, c, d, rgb, shine = 0) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1; n = n.map(c => c / len);
    for (const p of c === d ? [a, b, c] : [a, b, c, a, c, d]) { out.position.push(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]); out.normal.push(...n); out.color.push(...rgb); out.retro.push(shine); out.groundDelta.push(delta); }
  };
  // A box of half-sizes (across, up, along) around a centre, turned to heading.
  const box = (px, py, pz, heading, ha, hu, hl, rgb, shine = 0) => {
    const s = Math.sin(heading), c = Math.cos(heading), at = (a, u, l) => [px + c * a + s * l, py + u, pz - s * a + c * l];
    const p = [at(-ha, -hu, -hl), at(ha, -hu, -hl), at(ha, -hu, hl), at(-ha, -hu, hl), at(-ha, hu, -hl), at(ha, hu, -hl), at(ha, hu, hl), at(-ha, hu, hl)];
    quad(p[4], p[7], p[6], p[5], rgb); quad(p[0], p[1], p[2], p[3], rgb);
    quad(p[0], p[4], p[5], p[1], rgb, shine); quad(p[1], p[5], p[6], p[2], rgb); quad(p[2], p[6], p[7], p[3], rgb, shine); quad(p[3], p[7], p[4], p[0], rgb);
  };
  // A flat convex shape on a board's face: points in metres (across, up)
  // from the face centre, which looks along facing (radians, as headings).
  const face = (px, py, pz, facing, points, rgb, shine, lift = .004) => {
    const s = Math.sin(facing), c = Math.cos(facing), at = ([a, u]) => [px + c * a + s * lift, py + u, pz - s * a + c * lift];
    for (let k = 1; k < points.length - 1; k++) { const a = at(points[0]), b = at(points[k]), d = at(points[k + 1]); quad(a, b, d, d, rgb, shine); }
  };
  const post = (x, z, height, rgb, r = .05) => { const y = world.surface(x, z); box(x, y + height / 2, z, 0, r, height / 2, r, rgb); return y; };
  // A sign: its own piece, built by draw(y) in world space and kept relative
  // to its foot, and an obstacle that breaks (falls) when hit.
  const sign = (id, x, z, height, draw) => {
    const y = world.surface(x, z), start = signParts.position.length / 3;
    rest(x, z); out = signParts; origin = [x, y, z];
    draw(y);
    out = fixed; origin = [0, 0, 0];
    signs.push({ id, x, y, z, start, count: signParts.position.length / 3 - start });
    obstacles.push({ type: 'sign', id, x, z, y, h: height, r: .1 });
  };

  const roads = world.roadsNear(x0 + CHUNK / 2, z0 + CHUNK / 2, CHUNK);
  for (const road of roads) {
    const unit = road.length / (road.count - 1), p = road.points;
    // The stretch of this road that matters here: within 70 m of the chunk.
    let s0 = Infinity, s1 = -Infinity;
    for (let k = 0; k < road.count; k++) {
      const x = p[k * 2], z = p[k * 2 + 1];
      if (x > x0 - 70 && x < x0 + CHUNK + 70 && z > z0 - 70 && z < z0 + CHUNK + 70) { s0 = Math.min(s0, k * unit); s1 = Math.max(s1, k * unit); }
    }
    if (s0 > s1) continue;
    s0 = Math.max(0, s0 - 60); s1 = Math.min(road.length, s1 + 60);
    const [startArm, endArm] = world.roadEnds(road);
    const curveAt = s => { const f = Math.min(s / road.length, 1) * (road.count - 1), k = Math.min(Math.floor(f), road.count - 2); return road.curve[k] + (road.curve[k + 1] - road.curve[k]) * (f - k); };
    const levelAt = s => { const f = Math.min(s / road.length, 1) * (road.count - 1), k = Math.min(Math.floor(f), road.count - 2); return road.level[k] + (road.level[k + 1] - road.level[k]) * (f - k); };
    // Clear of junctions and bridge decks (which have their own railings).
    const open = (s, margin) => s > (startArm ? startArm.setback + margin : 4) && s < road.length - (endArm ? endArm.setback + margin : 4)
      && !road.bridges.some(b => s > (b.i0 - .6) * unit - 2 && s < (b.i1 + .6) * unit + 2);
    // Stands beside this road alone (not on another road).
    const clear = (x, z, gap) => { const here = world.roadAt(x, z); return here.id === road.id && here.od > gap; };

    // Guardrails, 6 m out: on the outside of tight bends, and wherever the
    // ground falls away more than 2.4 m beside the road. Runs under 20 m are
    // dropped, and each runs on 8 m past where it is needed.
    for (const side of [-1, 1]) {
      const STEP = 2, first = Math.floor(s0 / STEP), last = Math.ceil(s1 / STEP), need = [];
      for (let i = first; i <= last; i++) {
        const s = i * STEP, curve = curveAt(s), out = world.alongRoad(road, s, side * 13);
        need.push(open(s, 10) && ((Math.abs(curve) > TIGHT && Math.sign(curve) === -side) || levelAt(s) - world.groundSurface(out.x, out.z) > 2.4));
      }
      const railed = need.map(() => false);
      for (let i = 0; i < need.length;) {
        if (!need[i]) { i++; continue; }
        let j = i; while (j < need.length && need[j]) j++;
        if ((j - i) * STEP >= 20) for (let k = Math.max(0, i - 4); k < Math.min(need.length, j + 4); k++) railed[k] = open((first + k) * STEP, 4);
        i = j;
      }
      for (let i = 0; i < railed.length - 1; i++) {
        if (!railed[i] || !railed[i + 1]) continue;
        const sa = (first + i) * STEP, sb = sa + STEP, a = world.alongRoad(road, sa, side * 6.1), b = world.alongRoad(road, sb, side * 6.1);
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        if (!mine(mx, mz) || !clear(mx, mz, 7)) continue;
        rest(mx, mz);
        const ya = world.surface(a.x, a.z), yb = world.surface(b.x, b.z);
        // The beam: a steel band with a fold, its face toward the road.
        const nx = -Math.cos(a.heading) * side * .07, nz = Math.sin(a.heading) * side * .07;
        quad([a.x, ya + .45, a.z], [b.x, yb + .45, b.z], [b.x + nx, yb + .61, b.z + nz], [a.x + nx, ya + .61, a.z + nz], RAIL);
        quad([a.x + nx, ya + .61, a.z + nz], [b.x + nx, yb + .61, b.z + nz], [b.x, yb + .77, b.z], [a.x, ya + .77, a.z], RAIL);
        quad([a.x, ya + .77, a.z], [b.x, yb + .77, b.z], [b.x - nx, yb + .77, b.z - nz], [a.x - nx, ya + .77, a.z - nz], RAIL);
        if ((first + i) % 2 === 0) {
          const post = world.alongRoad(road, sa, side * 6.25);
          box(post.x, ya + .37, post.z, post.heading, .05, .37, .05, STEEL);
          // A reflector on every other post, on the beam's face toward the road.
          if ((first + i) % 4 === 0) { const r = world.alongRoad(road, sa, side * 5.99); box(r.x, ya + .62, r.z, r.heading, .01, .035, .05, side > 0 ? WHITE : AMBER, 1); }
        }
        obstacles.push({ type: 'rail', ax: a.x, az: a.z, bx: b.x, bz: b.z, x: mx, z: mz, y: Math.min(ya, yb), h: .8, r: .12 });
      }
    }

    // Chevron boards, 7.6 m out round the outside of the sharpest bends,
    // every 20 m, facing both ways; each board's arrows point into the bend.
    for (let s = Math.ceil(s0 / 20) * 20; s <= s1; s += 20) {
      const curve = curveAt(s);
      if (Math.abs(curve) < SHARP || !open(s, 15)) continue;
      const side = -Math.sign(curve), at = world.alongRoad(road, s, side * 7.6);
      if (!mine(at.x, at.z) || !clear(at.x, at.z, 9)) continue;
      sign(`sign:${road.id}:${s}`, at.x, at.z, 2.1, y => {
        post(at.x, at.z, 1.75, STEEL, .045);
        box(at.x, y + 1.7, at.z, at.heading, .46, .4, .015, BLACK);
        for (const facing of [at.heading, at.heading + Math.PI]) {
          // Arrows point toward the inside of the bend, as seen by whoever faces the board.
          const toward = facing === at.heading ? -side : side;
          for (const off of [-.19, .19]) {
            // Each chevron is two strokes meeting at its tip.
            const tip = off + toward * .1, back = off - toward * .1, w = toward * .1, fx = at.x + Math.sin(facing) * .015, fz = at.z + Math.cos(facing) * .015;
            face(fx, y + 1.7, fz, facing, [[back, .28], [tip, 0], [tip + w, 0], [back + w, .28]], YELLOW, 1);
            face(fx, y + 1.7, fz, facing, [[tip, 0], [back, -.28], [back + w, -.28], [tip + w, 0]], YELLOW, 1);
          }
        }
      });
    }

    // White marker posts every 42 m on both sides, with a reflector facing
    // each way (amber on the right, white on the left), except where a
    // guardrail runs.
    for (let s = 21; s < road.length - 21; s += 42) {
      if (s < s0 || s > s1) continue;
      for (const side of [-1, 1]) {
        const at = world.alongRoad(road, s, side * 6.4);
        if (!mine(at.x, at.z) || world.roadAt(at.x, at.z).d < 5.8 || obstacles.some(o => o.type === 'rail' && Math.hypot(o.x - at.x, o.z - at.z) < 4)) continue;
        rest(at.x, at.z);
        const y = world.surface(at.x, at.z);
        box(at.x, y + .5, at.z, at.heading, .06, .5, .06, WHITE);
        box(at.x, y + .86, at.z, at.heading, .062, .07, .062, BLACK);
        box(at.x, y + .72, at.z, at.heading, .03, .05, .07, side > 0 ? WHITE : AMBER, 1);
      }
    }
  }

  // At each junction: a stop sign beside every side road's stop line, on its
  // incoming lane's right, and one fingerpost on the widest corner with a
  // board pointing up each road.
  const seen = new Set();
  for (const road of roads) for (const id of road.id.split('>')) {
    if (seen.has(id)) continue; seen.add(id);
    const junction = world.junctionAt(id);
    if (!junction || junction.arms.length < 3) continue;
    for (const arm of junction.arms) {
      if (arm.main) continue;
      const s = arm.start ? arm.setback + 1.5 : arm.e.length - arm.setback - 1.5, at = world.alongRoad(arm.e, s, (arm.start ? 1 : -1) * 6.7);
      if (!mine(at.x, at.z)) continue;
      // It faces the cars coming toward the junction.
      sign(`sign:${arm.e.id}:${arm.start ? 'start' : 'end'}`, at.x, at.z, 3.1, y => {
        post(at.x, at.z, 2.4, STEEL, .045);
        const facing = arm.start ? at.heading : at.heading + Math.PI, fx = Math.sin(facing) * .02, fz = Math.cos(facing) * .02;
        const ring = r => Array.from({ length: 8 }, (_, k) => [Math.cos((k + .5) * Math.PI / 4) * r, Math.sin((k + .5) * Math.PI / 4) * r]);
        face(at.x, y + 2.5, at.z, facing, ring(.62), WHITE, 1, .02);
        face(at.x + fx * .1, y + 2.5, at.z + fz * .1, facing, ring(.55), RED, 1, .024);
        face(at.x - fx, y + 2.5, at.z - fz, facing + Math.PI, ring(.62), STEEL, 0, .02);
        face(at.x, y + 2.5, at.z, facing, [[-.37, .085], [.37, .085], [.37, -.085], [-.37, -.085]], WHITE, 1, .028);
      });
    }
    // The widest gap between neighbouring roads.
    const angles = junction.arms.map(a => Math.atan2(a.dx, a.dz)).sort((a, b) => a - b);
    let gap = -1, mid = 0;
    for (let k = 0; k < angles.length; k++) {
      const a = angles[k], b = k + 1 < angles.length ? angles[k + 1] : angles[0] + Math.PI * 2;
      if (b - a > gap) { gap = b - a; mid = (a + b) / 2; }
    }
    const x = junction.x + Math.sin(mid) * 13, z = junction.z + Math.cos(mid) * 13;
    if (!mine(x, z) || world.roadAt(x, z).d < 7) continue;
    sign(`sign:${junction.id}`, x, z, 3.3, y => {
      post(x, z, 3.2, WHITE, .07);
      junction.arms.slice(0, 4).forEach((arm, k) => {
        const heading = Math.atan2(arm.dx, arm.dz), bx = x + arm.dx * .93, bz = z + arm.dz * .93, by = y + 2.95 - k * .4;
        box(bx, by, bz, heading, .02, .15, .85, BOARD, 1);
        box(x + arm.dx * 1.82, by, z + arm.dz * 1.82, heading + Math.PI / 4, .019, .14, .1, BOARD, 1);
      });
    });
  }

  const arrays = p => ({ position: new Float32Array(p.position), normal: new Float32Array(p.normal), color: new Float32Array(p.color), retro: new Float32Array(p.retro), groundDelta: new Float32Array(p.groundDelta) });
  return { mesh: fixed.position.length ? arrays(fixed) : null, signs: signs.length ? { ...arrays(signParts), list: signs } : null, obstacles };
}
