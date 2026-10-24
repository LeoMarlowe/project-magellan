import * as THREE from './vendor/three.module.js';
import { GRID, smoothstep, clamp, cellWeights, splitsAlongAD } from './world.mjs?v=classes-2';
// The horizon tier's grid: fine enough (48 m) to keep the ranges' shape, so
// mountains barely change as they come nearer.
export const ULTRA_GRID = 48;
import { lakeRadius } from './lakes.mjs?v=classes-2';
import { SNOW_LINE, TREELINE } from './landforms.mjs?v=classes-2';
import { noise } from './noise.mjs?v=terrain-1';
export function createTerrain(world) {
  const seed = world.seed;
  const groundColors = { grass: new THREE.Color('#7e9059'), sand: new THREE.Color('#d9b873'), lush: new THREE.Color('#536e48'), dry: new THREE.Color('#b2a477'), snow: new THREE.Color('#e2e5e3'),
    alpine: new THREE.Color('#8f9463'), scree: new THREE.Color('#99958b'), granite: new THREE.Color('#8e9385'), graniteDark: new THREE.Color('#72776f'), sandstone: new THREE.Color('#c28a5a'), sandstoneDark: new THREE.Color('#9c6440') };
  const tmpColor = new THREE.Color(), rockColor = new THREE.Color(), redRock = new THREE.Color();
  // The midday sun's direction across the ground: slopes facing it are drier
  // and hold less snow.
  const sunX = -.872, sunZ = .489;
  // Far (24 m) and horizon (96 m) samples are revisited by neighbouring tiles.
  const sampleCaches = { 24: new Map(), 48: new Map() };
  function terrainSample(x, z, step) {
    const key = `${x},${z}`, cache = sampleCaches[step];
    if (cache?.has(key)) return cache.get(key);
    // Shading follows the ground over 8 m (or the tier's own cell); colour
    // (rock, scree, snow, sunny slopes) follows its lie over 24 m on every
    // tier, so the small ripples of a mountainside don't stripe it grass and
    // rock column by column, and colours stay put as the tiers swap.
    const h = world.height(x, z), delta = Math.max(4, step / 2);
    const gx = (world.height(x + delta, z) - world.height(x - delta, z)) / (2 * delta);
    const gz = (world.height(x, z + delta) - world.height(x, z - delta)) / (2 * delta);
    const length = Math.hypot(gx, 1, gz);
    const wx = (world.height(x + 12, z) - world.height(x - 12, z)) / 24, wz = (world.height(x, z + 12) - world.height(x, z - 12)) / 24;
    const slope = Math.hypot(wx, wz), mountain = world.mountainAt(x, z), desert = world.desertAt(x, z, h);
    // 1 facing the midday sun, -1 facing away (flat ground counts as neither).
    const sunny = clamp(-(wx * sunX + wz * sunZ) / (slope + .05), -1, 1) * smoothstep(.05, .3, slope);
    // Grass: lusher in the woods, with smooth drier patches, drier on sunny
    // slopes, turning to alpine meadow above the trees.
    tmpColor.copy(groundColors.grass).lerp(groundColors.lush, smoothstep(.3, .8, world.woodlandAt(x, z)) * .65);
    const patches = noise(x / 70, z / 70, seed + 18) * .6 + noise(x / 23 + 4.1, z / 23, seed + 19) * .4;
    tmpColor.lerp(groundColors.dry, smoothstep(.5, .8, patches) * .12 + Math.max(0, sunny) * .1);
    // Valleys and hollows hold water and grow lusher; ridges and rises dry out.
    const dip = world.hollow(x, z);
    tmpColor.lerp(groundColors.lush, smoothstep(.4, 3, dip) * .35);
    tmpColor.lerp(groundColors.dry, smoothstep(.4, 3, -dip) * .14);
    tmpColor.lerp(groundColors.alpine, smoothstep(TREELINE - 25, TREELINE + 35, h) * .65);
    tmpColor.lerp(groundColors.sand, desert);
    // Loose rock on the high, moderately steep mountain slopes, and rubble
    // gathered at the foot of slopes in the ranges and under the mesas.
    const scree = mountain * smoothstep(.3, .5, slope) * smoothstep(TREELINE - 40, TREELINE + 20, h);
    tmpColor.lerp(groundColors.scree, scree * .55);
    const foot = smoothstep(.6, 3, dip) * smoothstep(.12, .3, slope) * (1 - smoothstep(.55, .8, slope)) * clamp(mountain * 2 + desert, 0, 1);
    tmpColor.lerp(rockColor.copy(groundColors.scree).lerp(groundColors.sandstoneDark, desert * .7), foot * .5);
    // Rock faces where it is too steep for soil, and bare ground high in the
    // ranges: layered sandstone in the desert, banded granite elsewhere.
    // The bands climb with height, so on a steep face neighbouring grid points
    // sit far apart in them: where the grid can't follow them they fade to
    // their average, instead of aliasing into blocks.
    const climb = Math.hypot(gx, gz) * Math.max(step, GRID) * .25, legible = 1 - smoothstep(.9, 1.8, climb);
    const bands = .5 + .5 * Math.sin(h * .25 + noise(x / 40, z / 40, seed + 20) * 3) * legible;
    rockColor.copy(groundColors.granite).lerp(groundColors.graniteDark, bands * .7);
    redRock.copy(groundColors.sandstone).lerp(groundColors.sandstoneDark, bands);
    rockColor.lerp(redRock, desert);
    // In the ranges rock shows through at gentler slopes, and more above the trees.
    const bare = smoothstep(.5 - .14 * mountain, .9 - .2 * mountain, slope) + mountain * smoothstep(TREELINE - 20, TREELINE + 50, h) * smoothstep(.15, .4, slope) * .6;
    tmpColor.lerp(rockColor, clamp(bare, 0, 1) * .9);
    // Snow above a ragged line, lower on shady faces; the steepest faces shed it.
    const line = SNOW_LINE + (noise(x / 180, z / 180, seed + 21) - .5) * 50 + sunny * 25;
    tmpColor.lerp(groundColors.snow, smoothstep(line - 15, line + 25, h) * (1 - smoothstep(.85, 1.2, slope)) * .92);
    const lake = world.lakeAt?.(x, z);
    if (lake) tmpColor.lerp(groundColors.sand, (1 - smoothstep(.5, 3.8, h - lake.level)) * (1 - smoothstep(1.05, lake.sea ? 1.3 : 1.4, lakeRadius(lake, x, z))) * .84);
    const sample = { height: h, normal: [-gx / length, 1 / length, -gz / length], color: [tmpColor.r, tmpColor.g, tmpColor.b] };
    if (cache) {
      if (cache.size >= 30000) cache.delete(cache.keys().next().value);
      cache.set(key, sample);
    }
    return sample;
  }
  // The surface a coarser tier actually draws: its grid triangles, split the
  // same way as the rendered index buffers (cellWeights).
  function gridSample(x, z, step) {
    const ix = Math.floor(x / step) * step, iz = Math.floor(z / step) * step;
    const u = (x - ix) / step, v = (z - iz) / step, at = [[ix, iz], [ix + step, iz], [ix, iz + step], [ix + step, iz + step]];
    const samples = at.map(([px, pz]) => terrainSample(px, pz, step)), weights = cellWeights(u, v, ...samples.map(s => s.height));
    const result = { height: 0, normal: [0,0,0], color: [0,0,0] };
    for (let k = 0; k < 4; k++) {
      const sample = samples[k], weight = weights[k];
      if (!weight) continue;
      result.height += sample.height * weight;
      for (let i=0; i<3; i++) { result.normal[i] += sample.normal[i]*weight; result.color[i] += sample.color[i]*weight; }
    }
    return result;
  }
  const coarseSample = (x, z) => gridSample(x, z, 24), ultraSample = (x, z) => gridSample(x, z, ULTRA_GRID);
  function terrainGeometry(wx, wz, size, step, exclude = null) {
    const positions = [], colors = [], normals = [], indices = [], split = [], coarseHeights = [], coarseNormals = [], coarseColors = [], ultraHeights = [];
    const n = Math.round(size / step);
    for (let iz = 0; iz <= n; iz++) for (let ix = 0; ix <= n; ix++) {
      const x = wx + ix * step, z = wz + iz * step, h = world.height(x, z);
      positions.push(ix * step, h, iz * step);
      const fine = terrainSample(x, z, step);
      normals.push(...fine.normal); colors.push(...fine.color);
      const distant = step === GRID ? coarseSample(x, z) : fine;
      coarseHeights.push(distant.height); coarseNormals.push(...distant.normal); coarseColors.push(...distant.color);
      // Far tiles blend toward the horizon tier's surface before meeting it.
      ultraHeights.push(step === 24 ? ultraSample(x, z).height : distant.height);
    }
    // Which diagonal each square is split along (the far tiers rebuild their
    // index lists as nearer tiles come and go, with this).
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const a = iz * (n + 1) + ix, b = a + 1, c = a + n + 1, d = c + 1;
      split.push(splitsAlongAD(positions[a * 3 + 1], positions[b * 3 + 1], positions[c * 3 + 1], positions[d * 3 + 1]) ? 1 : 0);
    }
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const x = wx + (ix + .5) * step, z = wz + (iz + .5) * step;
      if (exclude && x >= exclude.x0 && x < exclude.x1 && z >= exclude.z0 && z < exclude.z1) continue;
      const a = iz * (n + 1) + ix, b = a + 1, c = a + n + 1, d = c + 1;
      if (split[iz * n + ix]) indices.push(a, c, d, a, d, b);
      else indices.push(a, c, b, b, c, d);
    }
    return { position: new Float32Array(positions), normal: new Float32Array(normals), color: new Float32Array(colors), index: new Uint32Array(indices), split: new Uint8Array(split), coarseHeight: new Float32Array(coarseHeights), coarseNormal: new Float32Array(coarseNormals), coarseColor: new Float32Array(coarseColors), ultraHeight: new Float32Array(ultraHeights) };
  }
  return { build: terrainGeometry, coarseSample, ultraSample };
}
