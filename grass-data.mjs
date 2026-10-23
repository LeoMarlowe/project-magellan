import { CHUNK, GRID, hash, noise, random, smoothstep } from './world.mjs?v=roadside-1';
import { TREELINE } from './landforms.mjs?v=terrain-1';

// 1.2 m cells; noise clumps decide which are filled, so meadows get thick
// patches with gaps between them rather than an even sprinkle.
export const GRASS_GRID = 80;
export const MAX_GRASS_PER_CHUNK = GRASS_GRID * GRASS_GRID;

// Worker-only placement. Reuse the built terrain triangles instead of sampling
// procedural height/gradients for thousands of individual blades.
export function buildGrass(world, cx, cz, ground) {
  const roots = [], shapes = [], colors = [], stride = CHUNK / GRID + 1;
  const step = CHUNK / GRASS_GRID, wx = cx * CHUNK, wz = cz * CHUNK;
  const yAt = (x, z) => ground.position[(z * stride + x) * 3 + 1];
  const colorAt = (x, z, k) => ground.color ? ground.color[(z * stride + x) * 3 + k] : [.21, .28, .1][k];
  for (let iz = 0; iz < GRASS_GRID; iz++) for (let ix = 0; ix < GRASS_GRID; ix++) {
    const gx = cx * GRASS_GRID + ix, gz = cz * GRASS_GRID + iz;
    const x = (ix + .15 + hash(gx, gz, world.seed + 901) * .7) * step;
    const z = (iz + .15 + hash(gx, gz, world.seed + 902) * .7) * step;
    const px = wx + x, pz = wz + z, tx = Math.floor(x / GRID), tz = Math.floor(z / GRID);
    const u = x / GRID - tx, v = z / GRID - tz;
    const a = yAt(tx, tz), b = yAt(tx + 1, tz), c = yAt(tx, tz + 1), d = yAt(tx + 1, tz + 1);
    const h = u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
    const slope = u + v <= 1 ? Math.hypot(b - a, c - a) / GRID : Math.hypot(d - c, d - b) / GRID;
    const plains = (1 - smoothstep(.25, .55, world.mountainAt(px, pz)))
      * (1 - smoothstep(.55, .75, world.woodlandAt(px, pz)))
      * (1 - smoothstep(.22, .5, slope)) * (1 - smoothstep(TREELINE - 30, TREELINE + 10, h));
    const clump = smoothstep(.3, .72, noise(px * .07, pz * .07, world.seed + 909));
    const density = plains * (.22 + .73 * clump) * (.65 + .35 * noise(px * .045, pz * .045, world.seed + 906));
    if (hash(gx, gz, world.seed + 903) > density || world.desertAt(px, pz, h) > .12) continue;
    if (world.roadAt(px, pz).d < 7.5 || world.waterAt?.(px, pz) || world.reserved(px, pz)) continue;
    roots.push(x, h - .035, z);
    // Taller in the heart of a clump; coloured like the ground beneath it.
    shapes.push((.36 + hash(gx, gz, world.seed + 904) * .34) * (.8 + .45 * clump), hash(gx, gz, world.seed + 905) * Math.PI * 2, .85 + hash(gx, gz, world.seed + 907) * .3);
    const w = u + v <= 1 ? [1 - u - v, u, v, 0] : [0, 1 - v, 1 - u, u + v - 1];
    for (let k = 0; k < 3; k++) colors.push(w[0] * colorAt(tx, tz, k) + w[1] * colorAt(tx + 1, tz, k) + w[2] * colorAt(tx, tz + 1, k) + w[3] * colorAt(tx + 1, tz + 1, k));
  }
  // Mobile uses a prefix of this shuffled set, distributed across the whole
  // chunk rather than dropping half of its rows. Revisited chunks stay identical.
  const rng = random((hash(cx, cz, world.seed + 908) * 4294967296) >>> 0);
  for (let i = roots.length / 3 - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    for (const data of [roots, shapes, colors]) for (let k = 0; k < 3; k++) {
      const temp = data[i * 3 + k]; data[i * 3 + k] = data[j * 3 + k]; data[j * 3 + k] = temp;
    }
  }
  return { roots: new Float32Array(roots), shapes: new Float32Array(shapes), colors: new Float32Array(colors) };
}
