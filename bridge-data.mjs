// Bridge geometry, built in the worker: where a road crosses a river (see
// roads.mjs) a concrete deck carries it, with the road's markings, curbs,
// posts and a rail along both sides, and piers down to the riverbed. Each
// bridge belongs to the tile its middle lies in. Positions are in world space
// (the mesh sits at the origin); one vertex-coloured material draws them all.
const ASPHALT = [.105, .118, .115], PAINT = [.77, .72, .56], CONCRETE = [.62, .61, .57], SHADE = [.45, .45, .42];

export function buildBridges(world, x0, z0, size) {
  const position = [], normal = [], color = [];
  const quad = (a, b, c, d, rgb) => {
    // Two triangles a-b-c, a-c-d with one flat normal.
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1; n = n.map(c => c / len);
    for (const p of [a, b, c, a, c, d]) { position.push(...p); normal.push(...n); color.push(...rgb); }
  };
  // A box of half-sizes (across, up, along) around a centre, turned to heading.
  const box = (cx, cy, cz, heading, ha, hu, hl, rgb) => {
    const s = Math.sin(heading), c = Math.cos(heading);
    const at = (a, u, l) => [cx + c * a + s * l, cy + u, cz - s * a + c * l];
    const p = [at(-ha, -hu, -hl), at(ha, -hu, -hl), at(ha, -hu, hl), at(-ha, -hu, hl), at(-ha, hu, -hl), at(ha, hu, -hl), at(ha, hu, hl), at(-ha, hu, hl)];
    quad(p[4], p[7], p[6], p[5], rgb); quad(p[0], p[1], p[2], p[3], rgb.map(v => v * .8));
    quad(p[0], p[4], p[5], p[1], rgb); quad(p[1], p[5], p[6], p[2], rgb); quad(p[2], p[6], p[7], p[3], rgb); quad(p[3], p[7], p[4], p[0], rgb);
  };
  for (const road of world.roadsNear(x0 + size / 2, z0 + size / 2, size)) for (const b of road.bridges) {
    const unit = road.length / (road.count - 1), s0 = (b.i0 - .6) * unit, s1 = (b.i1 + .6) * unit;
    const mid = world.alongRoad(road, (s0 + s1) / 2);
    if (mid.x < x0 || mid.x >= x0 + size || mid.z < z0 || mid.z >= z0 + size) continue;
    // Level across the span; its ends follow the approach ramps into the road.
    const levelAt = s => { const t = s / unit, k = Math.min(road.count - 2, Math.floor(t)); return road.level[k] + (road.level[k + 1] - road.level[k]) * (t - k); };
    const y = b.level;
    // The deck, in 2 m pieces so it follows the road's curve.
    const pieces = Math.max(2, Math.ceil((s1 - s0) / 2));
    for (let k = 0; k < pieces; k++) {
      const a = s0 + (s1 - s0) * k / pieces, e = s0 + (s1 - s0) * (k + 1) / pieces;
      const p = world.alongRoad(road, a), q = world.alongRoad(road, e);
      const ya = levelAt(a), ye = levelAt(e);
      const corner = (point, across, up) => [point.x + Math.cos(point.heading) * across, (point === p ? ya : ye) + up, point.z - Math.sin(point.heading) * across];
      // Road surface and its markings (edge lines, and the centre dashes on the same 14 m cycle as the roads).
      quad(corner(p, -5.4, .02), corner(q, -5.4, .02), corner(q, 5.4, .02), corner(p, 5.4, .02), ASPHALT);
      for (const side of [-1, 1]) quad(corner(p, side * 4.2, .03), corner(q, side * 4.2, .03), corner(q, side * 4.07, .03), corner(p, side * 4.07, .03), PAINT);
      if (Math.cos(((a + e) / 2) * Math.PI * 2 / 14) > 0) quad(corner(p, -.065, .03), corner(q, -.065, .03), corner(q, .065, .03), corner(p, .065, .03), PAINT);
      // Curbs, the deck's sides and its underside.
      for (const side of [-1, 1]) {
        quad(corner(p, side * 5.4, .28), corner(q, side * 5.4, .28), corner(q, side * 6, .28), corner(p, side * 6, .28), CONCRETE);
        quad(corner(p, side * 5.4, .02), corner(q, side * 5.4, .02), corner(q, side * 5.4, .28), corner(p, side * 5.4, .28), CONCRETE);
        quad(corner(p, side * 6, .28), corner(q, side * 6, .28), corner(q, side * 6, -.9), corner(p, side * 6, -.9), SHADE);
      }
      quad(corner(p, 6, -.9), corner(q, 6, -.9), corner(q, -6, -.9), corner(p, -6, -.9), SHADE);
    }
    // Posts every 3 m and a rail along each side.
    for (let s = s0 + 1; s < s1 - .5; s += 3) {
      const p = world.alongRoad(road, s);
      for (const side of [-1, 1]) box(p.x + Math.cos(p.heading) * side * 5.75, levelAt(s) + .78, p.z - Math.sin(p.heading) * side * 5.75, p.heading, .07, .5, .07, CONCRETE);
    }
    for (let k = 0; k < pieces; k++) {
      const s = s0 + (s1 - s0) * (k + .5) / pieces, p = world.alongRoad(road, s), half = (s1 - s0) / pieces / 2 + .02;
      for (const side of [-1, 1]) box(p.x + Math.cos(p.heading) * side * 5.75, levelAt(s) + 1.3, p.z - Math.sin(p.heading) * side * 5.75, p.heading, .08, .06, half, CONCRETE);
    }
    // Piers about every 14 m, from the deck down to the bed.
    const spans = Math.max(1, Math.round((s1 - s0) / 14));
    for (let k = 1; k < spans; k++) {
      const p = world.alongRoad(road, s0 + (s1 - s0) * k / spans), bed = world.groundSurface(p.x, p.z) - .5;
      if (bed > y - 1.2) continue;
      box(p.x, (y - .9 + bed) / 2, p.z, p.heading, 3.6, (y - .9 - bed) / 2, .55, SHADE);
    }
  }
  if (!position.length) return null;
  return { position: new Float32Array(position), normal: new Float32Array(normal), color: new Float32Array(color) };
}
