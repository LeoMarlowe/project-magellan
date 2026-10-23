// Shared maths for world generation: easing, seeded hashes and value noise.
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const mix = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
export function hash(x, z, seed) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function random(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function noise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  // Quintic interpolation keeps the first and second derivatives continuous.
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const u = fade(x - ix), v = fade(z - iz);
  return mix(mix(hash(ix, iz, seed), hash(ix + 1, iz, seed), u), mix(hash(ix, iz + 1, seed), hash(ix + 1, iz + 1, seed), u), v);
}
