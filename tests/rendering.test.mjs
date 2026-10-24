import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { cloneOwnedGeometry } from '../scenery.mjs';
import { createTerrain, ULTRA_GRID } from '../terrain.mjs';
import { farIndices, ultraIndices, ultraCoverage, FAR_SIZE, ULTRA_SIZE, FAR_VIEW, ULTRA_BLEND_END } from '../streaming-layout.mjs';
import { createWorld } from '../world.mjs';

test('chunk geometry owns its metadata and instance attributes independently', () => {
  const template = new THREE.BoxGeometry(), a = cloneOwnedGeometry(template), b = cloneOwnedGeometry(template);
  a.setAttribute('groundDelta', new THREE.InstancedBufferAttribute(new Float32Array([1, 2]), 1));
  b.setAttribute('groundDelta', new THREE.InstancedBufferAttribute(new Float32Array([3, 4, 5]), 1));
  assert.equal(template.userData.owned, undefined); assert.notEqual(a.userData, b.userData);
  assert.equal(template.hasAttribute('groundDelta'), false);
  let disposed = 0; b.addEventListener('dispose', () => disposed++); template.addEventListener('dispose', () => disposed++);
  a.dispose(); assert.equal(disposed, 0); assert.equal(b.getAttribute('groundDelta').count, 3);
  b.dispose(); template.dispose();
});
test('coarse tiles cut out only loaded fine chunks, including negative coordinates', () => {
  assert.equal(farIndices(0, 0, () => false).length, 16 * 16 * 6);
  assert.equal(farIndices(0, 0, () => true).length, 0);
  for (const tile of [-2, -1, 0, 1]) {
    const indices = farIndices(tile, tile, (cx, cz) => cx === tile * 4 && cz === tile * 4);
    assert.equal(indices.length, (256 - 16) * 6);
    assert.ok(indices.every(index => index >= 0 && index < 289));
  }
});
test('worker terrain retains exact fine triangles and matching coarse boundaries', () => {
  const world = createWorld(100003), terrain = createTerrain(world);
  const a = terrain.build(-96, 0, 96, 4), b = terrain.build(0, 0, 96, 4);
  for (let z = 0; z <= 24; z++) {
    const i = (z * 25 + 24) * 3, j = z * 25 * 3;
    assert.equal(a.position[i + 1], b.position[j + 1]);
    assert.equal(a.position[i + 1], Math.fround(world.height(0, z * 4)));
    assert.equal(a.coarseHeight[z * 25 + 24], b.coarseHeight[z * 25]);
    assert.deepEqual([...a.coarseColor.slice(i, i + 3)], [...b.coarseColor.slice(j, j + 3)]);
  }
});

test('debris remains bounded, falls onto terrain, expires and clears on world reset', async () => {
  const { createDebris } = await import('../debris.mjs');
  const scene = new THREE.Scene(), debris = createDebris(scene, 24);
  const prop = { type: 'tree', x: 0, y: 0, z: 0, size: 1, h: 6, vx: 40, vz: 0 };
  for (let i = 0; i < 10; i++) debris.burst(prop);
  assert.equal(debris.count, 24); assert.equal(scene.children.length, 1);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 100; i++) {
    debris.update(1 / 60, { surface: () => 0 });
    scene.children[0].getMatrixAt(0, matrix);
    assert.ok(matrix.elements.every(Number.isFinite)); assert.ok(matrix.elements[13] >= 0);
  }
  for (let i = 0; i < 150; i++) debris.update(1 / 60, { surface: () => 0 });
  assert.equal(debris.count, 0); assert.equal(scene.children[0].count, 0);
  debris.burst(prop); debris.clear(); assert.equal(debris.count, 0); assert.equal(scene.children[0].count, 0);
});

test('horizon tiles cut out loaded far tiles, and far tiles meet them with identical heights', () => {
  // A horizon tile has 32 × 32 squares (48 m), 8 × 8 under each far tile.
  const split = new Uint8Array(32 * 32);
  assert.equal(ultraIndices(0, 0, () => false, split).length, 32 * 32 * 6);
  assert.equal(ultraIndices(-1, 2, (fx, fz) => fx === -4 && fz === 8, split).length, (1024 - 64) * 6);
  assert.equal(ultraCoverage(0, 0, (fx, fz) => fx === 3 && fz === 3), 1 << 15);
  // The blend to horizon heights completes before the far tiles end.
  assert.ok(ULTRA_BLEND_END < FAR_VIEW * FAR_SIZE);
  const world = createWorld(100003), terrain = createTerrain(world);
  const horizon = terrain.build(0, 0, ULTRA_SIZE, ULTRA_GRID), far = terrain.build(FAR_SIZE, 0, FAR_SIZE, 24);
  // Along the far tile's whole outline, its fully blended height is the
  // horizon tile's own triangle surface: no cracks between the tiers.
  const ultraAt = (x, z) => terrain.ultraSample(x, z).height;
  for (let k = 0; k <= 16; k++) for (const [ix, iz] of [[k, 0], [k, 16], [0, k], [16, k]]) {
    const i = iz * 17 + ix, x = FAR_SIZE + ix * 24, z = iz * 24;
    assert.ok(Math.abs(far.ultraHeight[i] - ultraAt(x, z)) < 1e-4);
  }
  for (let iz = 0; iz <= 32; iz++) for (let ix = 0; ix <= 32; ix++) {
    assert.equal(horizon.position[(iz * 33 + ix) * 3 + 1], Math.fround(world.height(ix * ULTRA_GRID, iz * ULTRA_GRID)));
    assert.ok(Math.abs(ultraAt(ix * ULTRA_GRID, iz * ULTRA_GRID) - world.height(ix * ULTRA_GRID, iz * ULTRA_GRID)) < 1e-4);
  }
  // Every square is cut along its diagonal nearer in height, in the mesh and its index lists alike.
  assert.deepEqual([...ultraIndices(0, 0, () => false, horizon.split)], [...horizon.index]);
});
