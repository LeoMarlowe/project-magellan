import { CHUNK } from './world.mjs?v=roadside-1';
// Three terrain tiers, each covering 4 × 4 cells of the tier inside it:
// near chunks (96 m, 4 m grid), far tiles (384 m, 24 m grid) and horizon
// tiles (1536 m, 96 m grid) that keep mountains on the skyline when flying.
export const FAR_SIZE = CHUNK * 4;
export const ULTRA_SIZE = FAR_SIZE * 4;
export const NEAR_VIEW = 4;
export const FAR_VIEW = 4;
export const ULTRA_VIEW = 3;
// Far tiles blend to horizon-tile heights over this ring, which always lies
// inside the far tiles' outer edge (at least FAR_VIEW tiles from the car).
export const ULTRA_BLEND_START = 1150, ULTRA_BLEND_END = 1450;

// A tile's indices only change when this 16-bit coverage mask changes, not
// whenever the car crosses any chunk boundary.
function coverage(tx, tz, hasInner) {
  let mask = 0;
  for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) if (hasInner(tx * 4 + x, tz * 4 + z)) mask |= 1 << (z * 4 + x);
  return mask;
}
// A tile keeps its vertex data; only its index list changes as inner tiles
// arrive or leave. No overlapping triangles between tiers, and no cracks.
function indices(tx, tz, hasInner) {
  const result = [], n = 16, per = n / 4;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const cx = tx * 4 + Math.floor(x / per), cz = tz * 4 + Math.floor(z / per);
    if (hasInner(cx, cz)) continue;
    const a = z * (n + 1) + x, b = a + 1, c = a + n + 1;
    result.push(a, c, b, b, c, c + 1);
  }
  return result;
}
export const farCoverage = coverage, farIndices = indices;
export const ultraCoverage = coverage, ultraIndices = indices;
