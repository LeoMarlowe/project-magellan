// Typed arrays cross the worker boundary by transfer, with no terrain sampling
// or large mesh-generation loops left on the animation thread.
import { lakeExtent, lakeRadius } from './lakes.mjs?v=rivers-1';
export function buildWaterData(world, lake, terrain = null) {
  // Irregular sea coasts reach past the nominal radii; cover their full extent.
  const reach = lake.shape.length ? lakeExtent(lake) / Math.max(lake.rx, lake.rz) * 1.06 : 1.03;
  const hx = lake.rx * reach, hz = lake.rz * reach;
  // Large seas use a coarser grid, keeping one patch under 65,536 vertices.
  const step = Math.max(4, 4 * Math.ceil(Math.max(hx, hz) * 2 / 4 / 240));
  const x0 = Math.floor((lake.x - hx) / step) * step, z0 = Math.floor((lake.z - hz) / step) * step;
  const nx = Math.ceil(hx * 2 / step) + 1, nz = Math.ceil(hz * 2 / step) + 1;
  const count = (nx + 1) * (nz + 1);
  const position = new Float32Array(count * 3), bedDepth = new Float32Array(count), lakeUV = new Float32Array(count * 2), groundY = new Float32Array(count * 2);
  const indices = [];
  for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
    const i = iz * (nx + 1) + ix, x = x0 + ix * step, z = z0 + iz * step;
    position.set([x, lake.level + .012, z], i * 3);
    bedDepth[i] = lake.level - world.groundSurface(x, z);
    // Scaled so that length(lakeUV) = 1 on the (irregular) shoreline.
    const u = (x - lake.x) / lake.rx, v = (z - lake.z) / lake.rz, k = lakeRadius(lake, x, z) / (Math.hypot(u, v) || 1);
    lakeUV.set([u * k, v * k], i * 2);
    // Coarse terrain tiers under this vertex (see buildDistantWater).
    groundY.set(terrain ? [terrain.coarseSample(x, z).height, terrain.ultraSample(x, z).height] : [lake.level - 1, lake.level - 1], i * 2);
  }
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const a = iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d = c + 1;
    if (Math.max(bedDepth[a], bedDepth[b], bedDepth[c], bedDepth[d]) <= 0) continue;
    indices.push(a, c, b, b, c, d);
  }
  return { position, bedDepth, lakeUV, groundY, index: new Uint16Array(indices) };
}

// Every lake and sea out to the far horizon, built in the worker: concentric
// rings with depth sampled from the real bed (so colours match the detailed
// patches) and the heights of the coarse terrain tiers under each vertex, so
// distant water can ride just above whichever tier is drawn there.
export const DISTANT_WATER_RADIUS = 4600;
export function buildDistantWater(world, terrain, x, z) {
  const RIM = 40, RINGS = [.35, .65, .85, .97];
  const lakes = world.lakesNear(x, z, DISTANT_WATER_RADIUS);
  const position = [], bedDepth = [], lakeUV = [], groundY = [], index = [], ranges = [];
  for (const lake of lakes) {
    const base = position.length / 3, start = index.length;
    const vertex = (px, pz, u, v) => {
      position.push(px, lake.level + .012, pz);
      bedDepth.push(Math.max(.3, lake.level - world.groundSurface(px, pz))); lakeUV.push(u, v);
      groundY.push(terrain.coarseSample(px, pz).height, terrain.ultraSample(px, pz).height);
    };
    vertex(lake.x, lake.z, 0, 0);
    for (const r of RINGS) for (let i = 0; i < RIM; i++) {
      const a = i / RIM * Math.PI * 2, ux = Math.sin(a), uz = Math.cos(a);
      const shape = 1 / lakeRadius(lake, lake.x + ux * lake.rx, lake.z + uz * lake.rz);
      vertex(lake.x + ux * lake.rx * r * shape, lake.z + uz * lake.rz * r * shape, ux * r, uz * r);
    }
    // Counter-clockwise seen from above, so the triangles face up: the water
    // material draws front faces only, and from the air every distant lake
    // was culled until its detailed patch replaced it about 1 km away.
    for (let i = 0; i < RIM; i++) index.push(base, base + 1 + i, base + 1 + (i + 1) % RIM);
    for (let k = 0; k < RINGS.length - 1; k++) for (let i = 0; i < RIM; i++) {
      const a = base + 1 + k * RIM + i, b = base + 1 + k * RIM + (i + 1) % RIM, c = a + RIM, d = b + RIM;
      index.push(a, d, b, a, c, d);
    }
    ranges.push({ id: lake.id, start, count: index.length - start });
  }
  return { ranges, position: new Float32Array(position), bedDepth: new Float32Array(bedDepth), lakeUV: new Float32Array(lakeUV), groundY: new Float32Array(groundY), index: new Uint32Array(index) };
}

// River water for one terrain tile: a ribbon along each river, level across
// and falling downstream. Each stretch belongs to the tile its middle lies in,
// so neighbouring tiles never overlap. tier 0 is a near chunk, 1 a far tile
// (every stride-th point); the shader shows each tier on its own side of a
// fixed distance. Vertices beyond the banks have no depth and are discarded,
// so the water ends where the carved bank rises out of it.
export function buildRiverWater(world, terrain, x0, z0, size, tier, stride = 1) {
  const position = [], bedDepth = [], lakeUV = [], groundY = [], river = [], index = [];
  const ACROSS = [-1, -.55, 0, .55, 1];
  for (const r of world.riversNear(x0 + size / 2, z0 + size / 2, size)) {
    let previous = -1;
    for (let k = 0; k < r.count; k += stride) {
      const next = Math.min(r.count - 1, k + stride);
      if (next === k) break;
      const mx = (r.points[k * 2] + r.points[next * 2]) / 2, mz = (r.points[k * 2 + 1] + r.points[next * 2 + 1]) / 2;
      if (mx < x0 || mx >= x0 + size || mz < z0 || mz >= z0 + size) { previous = -1; continue; }
      const dx = r.points[next * 2] - r.points[k * 2], dz = r.points[next * 2 + 1] - r.points[k * 2 + 1], len = Math.hypot(dx, dz) || 1;
      // A cross-section at each end of the stretch (shared with the previous one).
      const section = q => {
        const start = position.length / 3, half = r.width[q] / 2 + 2.5, x = r.points[q * 2], z = r.points[q * 2 + 1];
        for (const t of ACROSS) {
          const px = x + dz / len * t * half, pz = z - dx / len * t * half;
          position.push(px, r.level[q] + .012, pz); bedDepth.push(r.level[q] - world.groundSurface(px, pz)); lakeUV.push(0, 0);
          groundY.push(terrain.coarseSample(px, pz).height, terrain.ultraSample(px, pz).height);
          // Downstream at about a metre a second, faster where the river falls.
          const speed = .9 + Math.min(2, (r.level[q] - r.level[Math.min(r.count - 1, q + 1)]) * 40);
          river.push(dx / len * speed, dz / len * speed, tier);
        }
        return start;
      };
      const a = previous >= 0 ? previous : section(k), b = section(next);
      for (let i = 0; i < ACROSS.length - 1; i++) index.push(a + i, b + i, a + i + 1, a + i + 1, b + i, b + i + 1);
      previous = b;
    }
  }
  if (!index.length) return null;
  return { position: new Float32Array(position), bedDepth: new Float32Array(bedDepth), lakeUV: new Float32Array(lakeUV), groundY: new Float32Array(groundY), river: new Float32Array(river), index: new Uint32Array(index) };
}
