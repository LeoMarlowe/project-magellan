import { createWorld, CHUNK, GRID } from './world.mjs?v=rivers-1';
import { createTerrain } from './terrain.mjs?v=rivers-1';
import { buildGrass } from './grass-data.mjs?v=terrain-1';
import { buildWaterData, buildDistantWater, buildRiverWater } from './water-data.mjs?v=rivers-1';
import { buildBridges } from './bridge-data.mjs?v=rivers-1';
import { FAR_SIZE, ULTRA_SIZE } from './streaming-layout.mjs?v=physics-16';
let world, terrain;
self.onmessage = ({ data: job }) => {
  try {
    if (!world || world.seed !== job.seed) { world = createWorld(job.seed); terrain = createTerrain(world); }
    const start = performance.now();
    if (job.kind === 'distant-water') {
      const water = buildDistantWater(world, terrain, job.x, job.z), { ranges, ...arrays } = water;
      self.postMessage({ ...job, ranges, water: arrays, workMs: performance.now() - start }, Object.values(arrays).map(array => array.buffer));
      return;
    }
    if (job.kind === 'water') {
      const water = buildWaterData(world, job.lake, terrain);
      self.postMessage({ ...job, water, workMs: performance.now() - start }, Object.values(water).map(array => array.buffer));
      return;
    }
    const size = job.kind === 'near' ? CHUNK : job.kind === 'ultra' ? ULTRA_SIZE : FAR_SIZE;
    const wx = job.cx * size, wz = job.cz * size;
    const ground = terrain.build(wx, wz, size, job.kind === 'near' ? GRID : job.kind === 'ultra' ? 96 : 24);
    // The tile's road map, for the ground shader to paint its roads from, and
    // its river water (near chunks and far tiles).
    const result = { ...job, ground, roadMap: world.roadMap(wx, wz, size, undefined, job.kind === 'near') };
    if (job.kind !== 'ultra') result.river = buildRiverWater(world, terrain, wx, wz, size, job.kind === 'near' ? 0 : 1, job.kind === 'near' ? 1 : 3);
    if (job.kind === 'near') result.bridges = buildBridges(world, wx, wz, size);
    if (job.kind === 'near') {
      result.grass = buildGrass(world, job.cx, job.cz, ground);
      result.props = world.props(job.cx, job.cz);
      result.features = world.featuresNear(wx + CHUNK / 2, wz + CHUNK / 2, 100).filter(f => Math.floor(f.x / CHUNK) === job.cx && Math.floor(f.z / CHUNK) === job.cz);
      // Marker posts every 42 m along both sides of each road (none where
      // they would stand on another road, as at junctions).
      result.roadside = [];
      for (const road of world.roadsNear(wx + CHUNK / 2, wz + CHUNK / 2, CHUNK)) for (let s = 21; s < road.length - 21; s += 42) for (const side of [-1, 1]) {
        const { x, z } = world.alongRoad(road, s, side * 6.4);
        if (Math.floor(x / CHUNK) !== job.cx || Math.floor(z / CHUNK) !== job.cz || world.roadAt(x, z).d < 5.8) continue;
        result.roadside.push({ type: 'post', x, z, y: world.surface(x, z), size: 1, turn: 0 });
      }
    }
    if (job.kind === 'far') {
      // Distant scenery: the same seeded trees, cacti, rocks, boulders, bushes
      // and outcrops the near chunks will place (with the model each one
      // uses), so each stand-in swaps with its real model in place and the
      // landscape never changes shape.
      const trees = { id: [], type: [], variant: [], x: [], z: [], size: [], turn: [], fineY: [], coarseY: [], ultraY: [] };
      for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) {
        for (const p of world.props(job.cx * 4 + dx, job.cz * 4 + dz)) {
          if (!['tree', 'cactus', 'rock', 'boulder', 'bush', 'outcrop'].includes(p.type)) continue;
          trees.id.push(p.id); trees.type.push(p.type); trees.variant.push(p.variant ?? -1); trees.x.push(p.x); trees.z.push(p.z); trees.size.push(p.size); trees.turn.push(p.turn);
          trees.fineY.push(p.y); trees.coarseY.push(terrain.coarseSample(p.x, p.z).height); trees.ultraY.push(terrain.ultraSample(p.x, p.z).height);
        }
      }
      result.trees = trees;
    }
    result.workMs = performance.now() - start;
    self.postMessage(result, [...Object.values(ground), ...Object.values(result.grass || {}), ...Object.values(result.river || {}), ...Object.values(result.bridges || {}), result.roadMap].map(array => array.buffer));
  } catch (error) { self.postMessage({ id: job.id, generation: job.generation, error: error.message }); }
};
