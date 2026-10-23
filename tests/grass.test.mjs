import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { createWorld, CHUNK } from '../world.mjs';
import { createTerrain } from '../terrain.mjs';
import { buildGrass, MAX_GRASS_PER_CHUNK } from '../grass-data.mjs';
import { createGrass, CALM } from '../grass.mjs';
import { qualityLevels } from '../quality.mjs';
import { SNOW_LINE } from '../landforms.mjs';

test('grass is seeded, bounded and follows terrain triangles while leaving roads, sand and ramps clear', () => {
  let total = 0;
  for (const seed of [3, 77, 100003]) {
    const world = createWorld(seed), terrain = createTerrain(world);
    for (const [cx, cz] of [[0, 0], [-1, -1], [1, 1]]) {
      const ground = terrain.build(cx * CHUNK, cz * CHUNK, CHUNK, 4), data = buildGrass(world, cx, cz, ground);
      assert.deepEqual(data, buildGrass(world, cx, cz, ground));
      assert.ok(data.roots.length / 3 <= MAX_GRASS_PER_CHUNK); total += data.roots.length / 3;
      for (let i = 0; i < data.roots.length; i += 3) {
        const x = data.roots[i] + cx * CHUNK, y = data.roots[i + 1] + .035, z = data.roots[i + 2] + cz * CHUNK;
        assert.ok(data.roots[i] > 0 && data.roots[i] < CHUNK && data.roots[i + 2] > 0 && data.roots[i + 2] < CHUNK);
        assert.ok(Math.abs(y - world.surface(x, z)) < 1e-4);
        assert.ok(world.roadAt(x, z).d >= 7.5 - 1e-5); assert.equal(world.reserved(x, z), false);
        assert.ok(world.desertAt(x, z, y) <= .12001); assert.ok(y < 110);
      }
    }
  }
  assert.ok(total > 1000, 'plains have visible grass, not just an empty valid result');
});

test('grass has no placement in sand, snow or steep terrain', () => {
  const world = createWorld(3), terrain = createTerrain(world), ground = terrain.build(0, 0, CHUNK, 4);
  assert.equal(buildGrass({ ...world, desertAt: () => 1 }, 0, 0, ground).roots.length, 0);
  const snowy = { position: ground.position.slice() }; for (let i = 1; i < snowy.position.length; i += 3) snowy.position[i] = SNOW_LINE;
  assert.equal(buildGrass(world, 0, 0, snowy).roots.length, 0);
  const steep = { position: ground.position.slice() }; for (let i = 0; i < steep.position.length; i += 3) steep.position[i + 1] = steep.position[i] * .6;
  assert.equal(buildGrass(world, 0, 0, steep).roots.length, 0);
});

test('grass render cost, mobile density and buffer ownership remain bounded across streaming', () => {
  const world = createWorld(3), terrain = createTerrain(world), data = buildGrass(world, 0, 0, terrain.build(0, 0, CHUNK, 4));
  const center = { value: new THREE.Vector2() }, desktop = createGrass(center), phone = createGrass(center, qualityLevels(true)[1].grass);
  const a = desktop.build(data), b = desktop.build(data), mobile = phone.build(data);
  assert.ok(a && b && mobile);
  assert.equal(a.castShadow, false); assert.equal(a.material.transparent, false);
  assert.equal(a.geometry.attributes.position.count, 60); // five cheap blades, then five bent blades of three triangles
  assert.deepEqual([a.geometry.drawRange.start, a.geometry.drawRange.count], [15, 45]);
  assert.deepEqual([mobile.geometry.drawRange.start, mobile.geometry.drawRange.count], [0, 15]);
  assert.equal(desktop.trianglesPerTuft, 15); assert.equal(phone.trianglesPerTuft, 5);
  assert.equal(a.geometry.attributes.grassColor.count, data.roots.length / 3);
  assert.equal(mobile.geometry.instanceCount, Math.floor(a.geometry.instanceCount * qualityLevels(true)[1].grass.density));
  assert.notEqual(a.geometry.attributes.position, b.geometry.attributes.position);
  const firstHalf = Array.from({ length: mobile.geometry.instanceCount }, (_, i) => [data.roots[i * 3], data.roots[i * 3 + 2]]);
  for (const xHalf of [0, 1]) for (const zHalf of [0, 1]) assert.ok(firstHalf.some(([x, z]) => Math.floor(x / 48) === xHalf && Math.floor(z / 48) === zHalf));
  for (const system of [desktop, phone]) for (const [x, z] of [[0, 0], [48, 48], [-.1, 96.1], [31, -37]]) {
    let visible = 0;
    for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) {
      system.update(a, cx, cz, x, z); visible += Number(a.visible);
    }
    assert.ok(visible <= (system === phone ? 4 : 9));
  }
  a.geometry.dispose(); assert.ok(b.geometry.attributes.position.array.every(Number.isFinite));
});

test('grass quality changes density and fade range live without rebuilding chunks', () => {
  const world = createWorld(3), terrain = createTerrain(world), data = buildGrass(world, 0, 0, terrain.build(0, 0, CHUNK, 4));
  const levels = qualityLevels(true), system = createGrass({ value: new THREE.Vector2() }, levels[3].grass), mesh = system.build(data);
  const total = mesh.geometry.userData.total;
  assert.equal(mesh.geometry.instanceCount, total);
  for (const level of levels) {
    system.setQuality(level.grass); system.update(mesh, 0, 0, 48, 48);
    assert.equal(mesh.geometry.instanceCount, Math.floor(total * level.grass.density));
    assert.equal(system.range, level.grass.range);
  }
  system.setQuality(levels[0].grass); system.update(mesh, 1, 0, 46, 48);
  assert.equal(mesh.visible, false);
  system.setQuality(levels[3].grass); system.update(mesh, 1, 0, 46, 48);
  assert.equal(mesh.visible, true);
});

test('each tuft takes the ground colour beneath it, and grass thins with distance but never pops', () => {
  const world = createWorld(3), terrain = createTerrain(world), ground = terrain.build(0, 0, CHUNK, 4), data = buildGrass(world, 0, 0, ground);
  assert.equal(data.colors.length, data.roots.length);
  for (let i = 0; i < data.colors.length; i += 3) {
    for (let k = 0; k < 3; k++) assert.ok(data.colors[i + k] >= 0 && data.colors[i + k] <= 1);
    assert.ok(data.colors[i + 1] >= data.colors[i + 2], 'green over blue: a meadow colour');
  }
  const system = createGrass({ value: new THREE.Vector2() }), mesh = system.build(data), total = mesh.geometry.userData.total;
  system.update(mesh, 0, 0, 48, 48); assert.equal(mesh.geometry.instanceCount, total);
  let previous = total;
  for (const x of [100, 120, 140, 160]) {
    system.update(mesh, 0, 0, x, 48);
    assert.ok(mesh.geometry.instanceCount <= previous); assert.ok(!mesh.visible || mesh.geometry.instanceCount >= total * .44);
    previous = mesh.geometry.instanceCount;
  }
  system.animate(12.5, 10, 2, 10, 1.4, .3); // wind and car push are plain uniforms
});

test('grass contrast softens with speed, from about 40 to 120 km/h, and returns when slowing', () => {
  const system = createGrass({ value: new THREE.Vector2() });
  const at = kmh => { system.animate(0, 0, 0, 0, .8, .6, kmh / 3.6); return system.calm; };
  assert.equal(at(0), 0); assert.equal(at(35), 0);
  assert.ok(Math.abs(at(130) - CALM) < 1e-9 && CALM === .6);
  let previous = 0;
  for (let kmh = 40; kmh <= 120; kmh += 5) { const calm = at(kmh); assert.ok(calm >= previous); previous = calm; }
  assert.ok(at(80) > .2 && at(80) < .4, 'about half way at 80 km/h');
  assert.equal(at(20), 0);
});
